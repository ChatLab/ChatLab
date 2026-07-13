/**
 * ChatLab HTTP API — Push Import route (/api/v1/imports/*)
 *
 * POST /api/v1/imports/:sessionId
 * Creates a new session or appends messages to an existing one.
 * See docs/cn/standard/chatlab-import.md for protocol spec.
 */

import type { FastifyInstance } from 'fastify'
import type { HttpRouteContext } from '../context'
import { hashImportBody, ImportIdempotencyCache, pushImport } from '@openchatlab/node-runtime'
import type { PushImportPayload } from '@openchatlab/node-runtime'
import {
  successResponse,
  errorResponse,
  invalidPayload,
  importInProgress,
  importFailed,
  idempotencyConflict,
  idempotencyPending,
} from '../errors'

export function registerImportRoutes(server: FastifyInstance, ctx: HttpRouteContext): void {
  const idempotencyCache = new ImportIdempotencyCache<ReturnType<typeof successResponse>>()

  server.post<{ Params: { sessionId: string }; Body: PushImportPayload }>(
    '/api/v1/imports/:sessionId',
    async (request, reply) => {
      const { sessionId } = request.params
      const contentType = request.headers['content-type'] || ''

      if (!contentType.includes('application/json')) {
        const err = invalidPayload('Content-Type must be application/json (JSONL is not yet supported)')
        return reply.code(err.statusCode).send(errorResponse(err))
      }

      if (request.headers['x-dry-run'] === 'true') {
        const err = invalidPayload('X-Dry-Run is not yet supported')
        return reply.code(err.statusCode).send(errorResponse(err))
      }

      const idempotencyKey = request.headers['idempotency-key']
      const cacheKey = typeof idempotencyKey === 'string' && idempotencyKey ? `${idempotencyKey}:${sessionId}` : null
      if (cacheKey) {
        const start = idempotencyCache.start(cacheKey, hashImportBody(request.body))
        if (start.status === 'conflict') {
          const err = idempotencyConflict()
          return reply.code(err.statusCode).send(errorResponse(err))
        }
        if (start.status === 'pending') {
          const err = idempotencyPending()
          return reply.code(err.statusCode).send(errorResponse(err))
        }
        if (start.status === 'success') return start.response
      }

      try {
        const outcome = await pushImport(ctx.dbManager, sessionId, request.body ?? {})

        if (!outcome.ok) {
          if (cacheKey) idempotencyCache.fail(cacheKey)
          if (outcome.reason === 'import_in_progress') {
            const err = importInProgress()
            return reply.code(err.statusCode).send(errorResponse(err))
          }
          if (outcome.reason === 'invalid_payload') {
            const err = invalidPayload(outcome.message)
            return reply.code(err.statusCode).send(errorResponse(err))
          }
          const err = importFailed(outcome.message)
          return reply.code(err.statusCode).send(errorResponse(err))
        }

        const response = successResponse(outcome.result)
        if (cacheKey) idempotencyCache.success(cacheKey, response)
        return response
      } catch (error) {
        if (cacheKey) idempotencyCache.fail(cacheKey)
        throw error
      }
    }
  )
}
