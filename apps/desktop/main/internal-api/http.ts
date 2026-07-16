import type { FastifyInstance, FastifyReply } from 'fastify'
import { createBearerAuthHook } from '@openchatlab/http-routes/auth'

interface InternalHttpOptions {
  token: string
  isDev: boolean
  devOrigin: string
}

export function configureInternalHttpServer(server: FastifyInstance, options: InternalHttpOptions): void {
  const setCorsHeader = (reply: FastifyReply, name: string, value: string) => {
    reply.header(name, value)
    reply.raw.setHeader(name, value)
  }

  server.addHook('onRequest', (request, reply, done) => {
    const origin = request.headers.origin
    if (!origin) {
      done()
      return
    }

    if (options.isDev) {
      const isLoopbackOrigin =
        origin.startsWith('http://localhost:') ||
        origin.startsWith('http://127.0.0.1:') ||
        origin.startsWith('http://[::1]:')
      if (origin === options.devOrigin || isLoopbackOrigin) {
        setCorsHeader(reply, 'Access-Control-Allow-Origin', origin)
      }
    } else if (origin === 'file://' || origin === 'app://' || origin === 'null') {
      setCorsHeader(reply, 'Access-Control-Allow-Origin', origin)
    }

    // SSE writes directly to the raw response, so keep both header stores in sync.
    setCorsHeader(reply, 'Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    setCorsHeader(reply, 'Access-Control-Allow-Headers', 'Content-Type, Authorization')

    if (request.method === 'OPTIONS') {
      reply.code(204).send()
      return
    }
    done()
  })

  server.addHook(
    'onRequest',
    createBearerAuthHook({
      getToken: () => options.token,
      allowMissingToken: false,
      shouldAuthenticate: (request) => request.method !== 'OPTIONS',
      missingTokenMessage: 'Missing or invalid token',
      invalidTokenMessage: 'Invalid token',
    })
  )
}
