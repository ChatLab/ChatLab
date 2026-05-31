/**
 * Aggregate route registration — one call to register all shared routes.
 *
 * CLI Server and Electron Internal Server call this instead of
 * importing individual route modules.
 */

import type { FastifyInstance } from 'fastify'
import type { HttpRouteContext } from './context'
import { registerSystemRoutes } from './routes/system'
import { registerRestSessionRoutes } from './routes/sessions'
import { registerSessionRoutes } from './routes/web/sessions'
import { registerMemberRoutes } from './routes/web/members'
import { registerPreferencesRoutes } from './routes/web/preferences'
import { registerAnalyticsRoutes } from './routes/web/analytics'
import { registerSqlRoutes } from './routes/web/sql'
import { registerSessionIndexRoutes } from './routes/web/session-index'
import { registerExportRoutes } from './routes/web/export'
import { registerNlpRoutes } from './routes/web/nlp'

export function registerSharedRoutes(server: FastifyInstance, ctx: HttpRouteContext): void {
  // REST API (/api/v1/*)
  registerSystemRoutes(server, ctx)
  registerRestSessionRoutes(server, ctx)

  // Web UI API (/_web/*)
  registerSessionRoutes(server, ctx)
  registerMemberRoutes(server, ctx)
  registerPreferencesRoutes(server, ctx)
  registerAnalyticsRoutes(server, ctx)
  registerSqlRoutes(server, ctx)
  registerSessionIndexRoutes(server, ctx)
  registerExportRoutes(server, ctx)
  registerNlpRoutes(server, ctx)
}
