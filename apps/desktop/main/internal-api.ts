/**
 * Electron Internal API Server
 *
 * Provides HTTP-based business communication for the Renderer process,
 * reusing @openchatlab/http-routes shared routes with ephemeral auth.
 *
 * Completely isolated from the user-facing External API Server
 * (apps/desktop/main/api/). Different port, different token, different lifecycle.
 */

import * as fs from 'fs'
import * as path from 'path'
import { randomBytes, createHmac, timingSafeEqual } from 'crypto'
import { ipcMain } from 'electron'
import Fastify, { type FastifyInstance, type FastifyError, type FastifyRequest, type FastifyReply } from 'fastify'
import type { PathProvider } from '@openchatlab/core'
import {
  DatabaseManager,
  createDatabaseManagerAdapter,
  LLMConfigStore,
  CustomProviderStore,
  CustomModelStore,
  MergeSessionCache,
  raiseChatDbCompatibilityGate,
  streamingImport,
} from '@openchatlab/node-runtime'
import type { StreamImportDeps } from '@openchatlab/node-runtime'
import multipart from '@fastify/multipart'
import type { ConfigStorage } from '@openchatlab/node-runtime'
import {
  registerSharedRoutes,
  ApiError,
  ApiErrorCode,
  apiErrorFromUnknown,
  errorResponse,
  serverError,
} from '@openchatlab/http-routes'
import type { HttpRouteContext } from '@openchatlab/http-routes'
import { resolveApiKey, writeAuthProfile } from '@openchatlab/config'
import { getManager as getAIChatManager } from './ai/chats'
import { getManager as getAssistantManager } from './ai/assistant/manager'
import { getManager as getSkillManager } from './ai/skills/manager'
import { createElectronRunAgentStream } from './ai/agent-stream-runner'
import { assertDesktopDataDirCompatible, getDesktopAppVersion } from './runtime-compat'

export interface InternalEndpoint {
  baseUrl: string
  token: string
}

let server: FastifyInstance | null = null
let endpoint: InternalEndpoint | null = null
let dbManager: DatabaseManager | null = null
let mergeCache: MergeSessionCache | null = null

const JSON_BODY_LIMIT = 50 * 1024 * 1024 // 50 MB

function createFileConfigStorage(aiDataDir: string): ConfigStorage {
  return {
    readJson<T>(key: string): T | null {
      try {
        return JSON.parse(fs.readFileSync(path.join(aiDataDir, `${key}.json`), 'utf-8')) as T
      } catch {
        return null
      }
    },
    writeJson<T>(key: string, data: T): void {
      if (!fs.existsSync(aiDataDir)) fs.mkdirSync(aiDataDir, { recursive: true })
      fs.writeFileSync(path.join(aiDataDir, `${key}.json`), JSON.stringify(data, null, 2), 'utf-8')
    },
  }
}

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
    const { app } = await import('electron')
    const runtime = assertDesktopDataDirCompatible(pathProvider, getDesktopAppVersion(app.getVersion()))

    newDbManager = new DatabaseManager(pathProvider, { runtime })
    const sessionAdapter = createDatabaseManagerAdapter(newDbManager)

    const aiDataDir = pathProvider.getAiDataDir()
    const llmConfigStore = new LLMConfigStore(createFileConfigStorage(aiDataDir), {
      resolveApiKey: (provider, authProfile) => resolveApiKey(provider, authProfile) || undefined,
      onApiKeyCreated: (config, apiKey) => {
        const profileName = config.name?.toLowerCase().replace(/\s+/g, '-') || config.provider
        writeAuthProfile(profileName, { type: 'api_key', provider: config.provider, key: apiKey })
        return profileName
      },
    })

    const configStorage = createFileConfigStorage(aiDataDir)

    const newMergeCache = new MergeSessionCache(pathProvider)
    newMergeCache.cleanupOrphans()

    const electronStreamImport = async (dm: DatabaseManager, filePath: string) => {
      const deps: StreamImportDeps = {
        openDatabase(sessionId: string) {
          return dm.openRawSessionDatabase(sessionId, { create: true, initializeChatTables: true })
        },
        deleteDatabase(sessionId: string) {
          dm.deleteSessionDatabaseFiles(sessionId)
        },
        onProgress() {
          /* no progress for merge-triggered import */
        },
      }
      const result = await streamingImport(filePath, deps)
      if (!result.sessionId) throw new Error('Import succeeded but no sessionId returned')
      try {
        raiseChatDbCompatibilityGate(pathProvider, runtime)
      } catch (error) {
        dm.deleteSessionDatabaseFiles(result.sessionId)
        throw error
      }
      return { sessionId: result.sessionId }
    }

    const { shell } = await import('electron')
    const { getDefaultUserDataDir, getUserDataDir, getDownloadsDir } = await import('./paths')

    const ctx: HttpRouteContext = {
      dbManager: newDbManager,
      sessionAdapter,
      pathProvider,
      getVersion: () => getDesktopAppVersion(app.getVersion()),
      mergeSessionCache: newMergeCache,
      streamImport: electronStreamImport,
      aiDataDir,
      aiChatManager: getAIChatManager(),
      assistantManager: getAssistantManager(),
      skillManagerCore: getSkillManager(),
      llmConfigStore,
      customProviderStore: new CustomProviderStore(configStorage),
      customModelStore: new CustomModelStore(configStorage),
      openDirectory: (dirPath) => shell.openPath(dirPath).then(() => {}),
      showInFolder: (filePath) => {
        shell.showItemInFolder(filePath)
        return Promise.resolve()
      },
      downloadsDir: getDownloadsDir(),
      defaultUserDataDir: getDefaultUserDataDir(),
      isCustomDataDir: path.resolve(getUserDataDir()) !== path.resolve(getDefaultUserDataDir()),
      runAgentStream: createElectronRunAgentStream(),
    }

    newServer = Fastify({ logger: false, bodyLimit: JSON_BODY_LIMIT })

    await newServer.register(multipart, { limits: { fileSize: 1024 * 1024 * 1024 } })

    // CORS: dev allows the Vite dev server origin; prod allows Electron app origins only
    const isDev = !app.isPackaged
    const devOrigin = process.env.ELECTRON_RENDERER_URL || 'http://localhost:13100'
    const setCorsHeader = (reply: FastifyReply, name: string, value: string) => {
      reply.header(name, value)
      reply.raw.setHeader(name, value)
    }
    newServer.addHook('onRequest', (request, reply, done) => {
      const origin = request.headers.origin
      if (!origin) {
        done()
        return
      }

      if (isDev) {
        const isLoopbackOrigin =
          origin.startsWith('http://localhost:') ||
          origin.startsWith('http://127.0.0.1:') ||
          origin.startsWith('http://[::1]:')
        if (origin === devOrigin || isLoopbackOrigin) {
          setCorsHeader(reply, 'Access-Control-Allow-Origin', origin)
        }
      } else if (origin === 'file://' || origin === 'app://' || origin === 'null') {
        setCorsHeader(reply, 'Access-Control-Allow-Origin', origin)
      }

      // SSE 路由会直接调用 reply.raw.writeHead()，因此 CORS 必须同时写到 raw response；
      // 只写 Fastify reply header 时，流式响应会丢失跨域头并在浏览器侧表现为 Failed to fetch。
      setCorsHeader(reply, 'Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
      setCorsHeader(reply, 'Access-Control-Allow-Headers', 'Content-Type, Authorization')

      if (request.method === 'OPTIONS') {
        reply.code(204).send()
        return
      }
      done()
    })

    newServer.addHook('onRequest', createInternalAuthHook(token))

    newServer.setErrorHandler((error: FastifyError, _request, reply) => {
      const apiError = apiErrorFromUnknown(error)
      if (apiError) {
        reply.code(apiError.statusCode).send(errorResponse(apiError))
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

    registerSharedRoutes(newServer, ctx, { requireAi: true })

    await newServer.listen({ port: 0, host: '127.0.0.1' })

    const address = newServer.server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    server = newServer
    dbManager = newDbManager
    mergeCache = newMergeCache
    endpoint = { baseUrl: `http://127.0.0.1:${port}`, token }
    console.log(`[InternalAPI] Server started on port ${port}`)

    return endpoint
  } catch (err) {
    try {
      await newServer?.close()
    } catch {
      /* best-effort */
    }
    try {
      newDbManager?.closeAll()
    } catch {
      /* best-effort */
    }
    server = null
    dbManager = null
    mergeCache = null
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
    try {
      mergeCache?.clear()
    } catch {
      /* best-effort */
    }
    try {
      dbManager?.closeAll()
    } catch {
      /* best-effort */
    }
    server = null
    endpoint = null
    dbManager = null
    mergeCache = null
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
