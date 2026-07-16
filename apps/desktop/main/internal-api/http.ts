import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify'
import {
  ApiError,
  ApiErrorCode,
  apiErrorFromUnknown,
  errorResponse,
  serverError,
} from '@openchatlab/http-routes/errors'
import { appLogger } from '@openchatlab/node-runtime'
import { createInternalAuthHook } from './auth'

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

  server.addHook('onRequest', createInternalAuthHook(options.token))

  server.setErrorHandler((error: FastifyError, request, reply) => {
    const apiError = apiErrorFromUnknown(error)
    if (apiError) {
      reply.code(apiError.statusCode).send(errorResponse(apiError))
      return
    }
    if (error.statusCode === 413) {
      const bodyError = new ApiError(ApiErrorCode.BODY_TOO_LARGE, 'Request body exceeds 50MB limit')
      reply.code(413).send(errorResponse(bodyError))
      return
    }
    const statusCode = (error as { statusCode?: number }).statusCode
    if (statusCode && statusCode >= 400 && statusCode < 600) {
      reply.code(statusCode).send({ success: false, error: { code: 'CLIENT_ERROR', message: error.message } })
      return
    }
    appLogger.error('http', `${request.method} ${request.url} -> 500`, error)
    const internalError = serverError(error.message)
    reply.code(internalError.statusCode).send(errorResponse(internalError))
  })
}
