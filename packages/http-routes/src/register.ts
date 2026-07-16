/** Aggregate registration for the shared REST and Web route groups. */

import type { FastifyInstance } from 'fastify'
import type { HttpRouteContext } from './context'
import { registerRestRoutes } from './routes/rest/register'
import { registerWebRoutes, type WebRouteOptions } from './routes/web/register'

export type SharedRouteOptions = WebRouteOptions

export function registerSharedRoutes(
  server: FastifyInstance,
  ctx: HttpRouteContext,
  options?: SharedRouteOptions
): void {
  registerRestRoutes(server, ctx)
  registerWebRoutes(server, ctx, options)
}
