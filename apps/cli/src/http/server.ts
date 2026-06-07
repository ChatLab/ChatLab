/**
 * ChatLab HTTP API — Fastify server factory
 *
 * 从 electron/main/api/server.ts 迁移，完全平台无关。
 */

import Fastify, { type FastifyInstance, type FastifyError } from 'fastify'
import {
  authHook,
  ApiError,
  ApiErrorCode,
  apiErrorFromUnknown,
  errorResponse,
  serverError,
} from '@openchatlab/http-routes'

const JSON_BODY_LIMIT = 50 * 1024 * 1024 // 50MB

export function createServer(): FastifyInstance {
  const server = Fastify({
    logger: false,
    bodyLimit: JSON_BODY_LIMIT,
  })

  server.addHook('onRequest', authHook)

  server.setErrorHandler((error: FastifyError, _request, reply) => {
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

  return server
}
