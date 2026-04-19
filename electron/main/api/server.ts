/**
 * ChatLab API — Fastify server instance
 */

import Fastify, { type FastifyInstance, type FastifyError } from 'fastify'
import { authHook } from './auth'
import { ApiError, ApiErrorCode, errorResponse, serverError } from './errors'
import { apiLogger } from './logger'

const JSON_BODY_LIMIT = 50 * 1024 * 1024 // 50MB

export function createServer(): FastifyInstance {
  const server = Fastify({
    logger: false,
    bodyLimit: JSON_BODY_LIMIT,
  })

  server.addHook('onRequest', authHook)

  server.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error instanceof ApiError) {
      reply.code(error.statusCode).send(errorResponse(error))
      return
    }

    if (error.statusCode === 413) {
      const bodyErr = new ApiError(ApiErrorCode.BODY_TOO_LARGE, 'Request body exceeds 50MB limit')
      reply.code(413).send(errorResponse(bodyErr))
      return
    }

    apiLogger.error('Unhandled error', error)
    const err = serverError(error.message)
    reply.code(err.statusCode).send(errorResponse(err))
  })

  return server
}
