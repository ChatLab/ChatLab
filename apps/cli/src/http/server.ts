/**
 * ChatLab HTTP API — Fastify server factory
 *
 * 从 electron/main/api/server.ts 迁移，完全平台无关。
 */

import type { FastifyInstance } from 'fastify'
import { authHook } from '@openchatlab/http-routes/auth'
import { createApiServer } from '@openchatlab/http-routes/server'
import { appLogger } from '@openchatlab/node-runtime'

export function createServer(): FastifyInstance {
  return createApiServer({
    authHook,
    onUnhandledError: (request, error) => {
      appLogger.error('http', `${request.method} ${request.url} -> 500`, error)
    },
  })
}
