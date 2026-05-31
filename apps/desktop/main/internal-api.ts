/**
 * Electron Internal API Server
 *
 * Provides HTTP-based business communication for the Renderer process,
 * reusing @openchatlab/http-routes shared routes with ephemeral auth.
 *
 * Completely isolated from the user-facing External API Server
 * (apps/desktop/main/api/). Different port, different token, different lifecycle.
 */

import { randomBytes, createHmac, timingSafeEqual } from 'crypto'
import { ipcMain } from 'electron'
import Fastify, { type FastifyInstance, type FastifyError, type FastifyRequest, type FastifyReply } from 'fastify'
import type { PathProvider } from '@openchatlab/core'
import { DatabaseManager, createDatabaseManagerAdapter } from '@openchatlab/node-runtime'
import { registerSharedRoutes, ApiError, ApiErrorCode, errorResponse, serverError } from '@openchatlab/http-routes'
import type { HttpRouteContext } from '@openchatlab/http-routes'

export interface InternalEndpoint {
  baseUrl: string
  token: string
}

let server: FastifyInstance | null = null
let endpoint: InternalEndpoint | null = null
let dbManager: DatabaseManager | null = null

const JSON_BODY_LIMIT = 50 * 1024 * 1024 // 50 MB

/**
 * Start the Internal API Server.
 * Must be called before createWindow() so the Renderer can retrieve the endpoint.
 */
export async function startInternalServer(pathProvider: PathProvider): Promise<InternalEndpoint> {
  if (server) return endpoint!

  let newServer: FastifyInstance | null = null
  let newDbManager: DatabaseManager | null = null

  try {
    const token = `int_${randomBytes(32).toString('hex')}`

    newDbManager = new DatabaseManager(pathProvider)
    const sessionAdapter = createDatabaseManagerAdapter(newDbManager)

    const { app } = await import('electron')

    const ctx: HttpRouteContext = {
      dbManager: newDbManager,
      sessionAdapter,
      pathProvider,
      getVersion: () => app.getVersion(),
    }

    newServer = Fastify({ logger: false, bodyLimit: JSON_BODY_LIMIT })

    // CORS: dev allows the Vite dev server origin; prod allows Electron app origins only
    const isDev = !app.isPackaged
    const devOrigin = process.env.ELECTRON_RENDERER_URL || 'http://localhost:13100'
    newServer.addHook('onRequest', (request, reply, done) => {
      const origin = request.headers.origin
      if (!origin) {
        done()
        return
      }

      if (isDev) {
        if (origin === devOrigin || origin.startsWith('http://localhost:')) {
          reply.header('Access-Control-Allow-Origin', origin)
        }
      } else if (origin === 'file://' || origin === 'app://' || origin === 'null') {
        reply.header('Access-Control-Allow-Origin', origin)
      }

      reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

      if (request.method === 'OPTIONS') {
        reply.code(204).send()
        return
      }
      done()
    })

    newServer.addHook('onRequest', createInternalAuthHook(token))

    newServer.setErrorHandler((error: FastifyError, _request, reply) => {
      if (error instanceof ApiError) {
        reply.code(error.statusCode).send(errorResponse(error))
        return
      }
      if (error.statusCode === 413) {
        const bodyErr = new ApiError(ApiErrorCode.BODY_TOO_LARGE, 'Request body exceeds 50MB limit')
        reply.code(413).send(errorResponse(bodyErr))
        return
      }
      const statusCode = (error as any).statusCode
      if (statusCode && statusCode >= 400 && statusCode < 600) {
        reply.code(statusCode).send({ success: false, error: { code: 'CLIENT_ERROR', message: error.message } })
        return
      }
      const err = serverError(error.message)
      reply.code(err.statusCode).send(errorResponse(err))
    })

    registerSharedRoutes(newServer, ctx)

    await newServer.listen({ port: 0, host: '127.0.0.1' })

    const address = newServer.server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    server = newServer
    dbManager = newDbManager
    endpoint = { baseUrl: `http://127.0.0.1:${port}`, token }
    console.log(`[InternalAPI] Server started on port ${port}`)

    return endpoint
  } catch (err) {
    // Cleanup partial initialization to avoid leaked resources
    try { await newServer?.close() } catch { /* best-effort */ }
    try { newDbManager?.closeAll() } catch { /* best-effort */ }
    server = null
    dbManager = null
    endpoint = null
    throw err
  }
}

export function getInternalEndpoint(): InternalEndpoint | null {
  return endpoint
}

export async function stopInternalServer(): Promise<void> {
  if (!server) return
  try {
    await server.close()
  } catch (err) {
    console.error('[InternalAPI] Error closing server:', err)
  } finally {
    try { dbManager?.closeAll() } catch { /* best-effort */ }
    server = null
    endpoint = null
    dbManager = null
    console.log('[InternalAPI] Server stopped')
  }
}

/**
 * Register IPC handler so the Renderer can retrieve the endpoint via preload.
 * Must be called before createWindow().
 */
export function registerInternalApiIpc(): void {
  ipcMain.handle('internal-api:getEndpoint', () => getInternalEndpoint())
}

// ==================== Auth Hook (Internal Only) ====================

const hmacKey = randomBytes(32)

function safeTokenCompare(a: string, b: string): boolean {
  const hashA = createHmac('sha256', hmacKey).update(a).digest()
  const hashB = createHmac('sha256', hmacKey).update(b).digest()
  return timingSafeEqual(hashA, hashB)
}

/**
 * Auth hook for the Internal Server. ALL routes require Bearer token, no exceptions.
 * Independent from @openchatlab/http-routes auth (which uses global state for External Server).
 */
function createInternalAuthHook(token: string) {
  return async function internalAuthHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (request.method === 'OPTIONS') return

    const authHeader = request.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' } })
      return
    }

    const provided = authHeader.slice(7)
    if (!safeTokenCompare(provided, token)) {
      reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } })
      return
    }
  }
}
