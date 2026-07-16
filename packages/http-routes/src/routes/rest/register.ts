import type { FastifyInstance } from 'fastify'
import type { RestRouteContext } from '../../context/rest'
import type { RuntimeRouteContext } from '../../context/runtime'
import { registerImportRoutes } from './imports'
import { createDatabaseRestSessionProvider } from './session-provider'
import { registerRestSessionRoutes } from './sessions'
import { registerSystemRoutes } from './system'

export type RestRoutesContext = Pick<RuntimeRouteContext, 'dbManager' | 'getVersion'> & RestRouteContext

/** Register the public REST API under /api/v1. */
export function registerRestRoutes(server: FastifyInstance, ctx: RestRoutesContext): void {
  const sessionProvider = ctx.restSessionProvider ?? createDatabaseRestSessionProvider(ctx.dbManager)

  registerSystemRoutes(server, {
    getVersion: ctx.getVersion,
    countSessions: sessionProvider.countSessions,
  })
  registerRestSessionRoutes(server, sessionProvider)
  registerImportRoutes(server, ctx)
}
