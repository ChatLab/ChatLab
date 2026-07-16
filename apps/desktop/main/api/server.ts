/**
 * ChatLab API — Fastify server instance
 */

import type { FastifyInstance } from 'fastify'
import { createBearerAuthHook } from '@openchatlab/http-routes/auth'
import { createApiServer } from '@openchatlab/http-routes/server'
import { getConfig } from './index'
import { apiLogger } from './logger'

export function createServer(): FastifyInstance {
  return createApiServer({
    authHook: createBearerAuthHook({
      getToken: () => getConfig().token,
      allowMissingToken: false,
    }),
    onUnhandledError: (request, error) => apiLogger.error(`${request.method} ${request.url} -> 500`, error),
  })
}
