/**
 * ChatLab HTTP API — Push Import route (/api/v1/imports/*)
 *
 * POST /api/v1/imports/:sessionId
 * Creates a new session or appends messages to an existing one.
 * See docs/cn/standard/chatlab-import.md for protocol spec.
 */

import type { FastifyInstance } from 'fastify'
import type { RuntimeRouteContext } from '../../context/runtime'
import { appLogger, pushImport } from '@openchatlab/node-runtime'
import type { PushImportPayload } from '@openchatlab/node-runtime'
import { createJsonPushImportHandler } from '../../import/json-push-handler'

type ImportRouteContext = Pick<RuntimeRouteContext, 'dbManager'>

export function registerImportRoutes(server: FastifyInstance, ctx: ImportRouteContext): void {
  const handleJsonPushImport = createJsonPushImportHandler({
    execute: (sessionId, payload) => pushImport(ctx.dbManager, sessionId, payload),
    onError: (error) => appLogger.error('http-import', 'Push import request failed', error),
  })

  server.post<{ Params: { sessionId: string }; Body: PushImportPayload }>(
    '/api/v1/imports/:sessionId',
    async (request, reply) => {
      const idempotencyKey = request.headers['idempotency-key']
      const result = await handleJsonPushImport({
        sessionId: request.params.sessionId,
        body: request.body,
        contentType: request.headers['content-type'] || '',
        idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : undefined,
        dryRun: request.headers['x-dry-run'] === 'true',
      })
      return reply.code(result.statusCode).send(result.response)
    }
  )
}
