/**
 * ChatLab HTTP API — Push Import route (/api/v1/imports/*)
 *
 * POST /api/v1/imports/:sessionId
 * Creates a new session or appends messages to an existing one.
 * See docs/cn/standard/chatlab-import.md for protocol spec.
 */

import type { FastifyInstance } from 'fastify'
import type { HttpRouteContext } from '../context'
import { pushImport } from '@openchatlab/node-runtime'
import type { PushImportPayload } from '@openchatlab/node-runtime'
import { successResponse, errorResponse, invalidPayload, importInProgress, importFailed } from '../errors'

export function registerImportRoutes(server: FastifyInstance, ctx: HttpRouteContext): void {
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

      const outcome = await pushImport(ctx.dbManager, sessionId, request.body ?? {})

      if (!outcome.ok) {
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

      return successResponse(outcome.result)
    }
  )
}
