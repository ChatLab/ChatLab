import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { ApiError, ApiErrorCode, apiErrorFromUnknown, errorResponse, serverError } from './errors'

export const DEFAULT_JSON_BODY_LIMIT = 50 * 1024 * 1024

export interface ApiServerOptions {
  bodyLimit?: number
  authHook?: (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>
  onUnhandledError?: (request: FastifyRequest, error: FastifyError) => void
}

export function configureApiErrorHandler(server: FastifyInstance, options: ApiServerOptions = {}): void {
  server.setErrorHandler((error: FastifyError, request, reply) => {
    const apiError = apiErrorFromUnknown(error)
    if (apiError) {
      reply.code(apiError.statusCode).send(errorResponse(apiError))
      return
    }

    if (error.statusCode === 413) {
      const bodyError = new ApiError(ApiErrorCode.BODY_TOO_LARGE, 'Request body exceeds 50MB limit')
      reply.code(bodyError.statusCode).send(errorResponse(bodyError))
      return
    }

    const statusCode = error.statusCode
    if (statusCode && statusCode >= 400 && statusCode < 600) {
      reply.code(statusCode).send({ success: false, error: { code: 'CLIENT_ERROR', message: error.message } })
      return
    }

    options.onUnhandledError?.(request, error)
    const internalError = serverError(error.message)
    reply.code(internalError.statusCode).send(errorResponse(internalError))
  })
}

export function createApiServer(options: ApiServerOptions = {}): FastifyInstance {
  const server = Fastify({
    logger: false,
    bodyLimit: options.bodyLimit ?? DEFAULT_JSON_BODY_LIMIT,
  })

  if (options.authHook) server.addHook('onRequest', options.authHook)
  configureApiErrorHandler(server, options)
  return server
}
