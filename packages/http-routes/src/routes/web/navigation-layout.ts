import type { FastifyInstance } from 'fastify'
import { createNavigationLayoutService, NavigationLayoutValidationError } from '@openchatlab/node-runtime'
import type { RuntimeRouteContext } from '../../context/runtime'
import type { ServiceRouteContext } from '../../context/services'

type NavigationLayoutRouteContext = Pick<RuntimeRouteContext, 'pathProvider'> &
  Pick<ServiceRouteContext, 'navigationLayoutService'>

export function registerNavigationLayoutRoutes(server: FastifyInstance, context: NavigationLayoutRouteContext): void {
  const service = context.navigationLayoutService ?? createNavigationLayoutService(context.pathProvider.getSystemDir())

  server.get('/_web/navigation-layout', async () => service.load())

  server.put<{ Body: unknown }>('/_web/navigation-layout', async (request, reply) => {
    try {
      const layout = service.save(request.body)
      return { status: 'saved' as const, layout }
    } catch (error) {
      if (error instanceof NavigationLayoutValidationError) {
        return reply.code(400).send({ error: 'INVALID_NAVIGATION_LAYOUT' })
      }
      throw error
    }
  })

  server.delete('/_web/navigation-layout', async () => {
    service.reset()
    return { status: 'missing' as const, layout: null }
  })
}
