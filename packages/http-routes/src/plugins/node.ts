import type { FastifyInstance } from 'fastify'
import type { RuntimeRouteContext } from '../context/runtime'
import type { ServiceRouteContext } from '../context/services'

export type NodePluginContext = Pick<
  RuntimeRouteContext,
  'sessionAdapter' | 'pathProvider' | 'runtimeIdentity' | 'nativeBinding'
> &
  ServiceRouteContext

/**
 * Static, trusted Node-side plugin facet.
 *
 * Route registration happens only during server startup. Fastify owns the
 * resulting route and service lifecycle until the server closes.
 */
export interface NodePluginDescriptor {
  readonly id: string
  registerHttpRoutes(server: FastifyInstance, context: NodePluginContext): void
}

export function registerNodePlugins(
  server: FastifyInstance,
  context: NodePluginContext,
  plugins: readonly NodePluginDescriptor[]
): void {
  for (const plugin of plugins) plugin.registerHttpRoutes(server, context)
}
