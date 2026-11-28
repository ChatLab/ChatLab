/**
 * ChatLab HTTP API — Fastify server factory
 *
 * 从 electron/main/api/server.ts 迁移，完全平台无关。
 */

import type { FastifyInstance } from 'fastify'
import { createApiServer } from '@openchatlab/http-routes/server'
import { appLogger } from '@openchatlab/node-runtime'
import { createCliAuthHook, type CliHttpAuthOptions } from './auth'

export function createServer(options: CliHttpAuthOptions): FastifyInstance {
  return createApiServer({
    authHook: createCliAuthHook(options),
    onUnhandledError: (request, error) => {
      appLogger.error('http', `${request.method} ${request.url} -> 500`, error)
    },
  })
}
