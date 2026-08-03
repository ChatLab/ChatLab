import type { FastifyInstance } from 'fastify'
import type { RuntimeRouteContext } from '../../context/runtime'
import { sessionIndexService } from '@openchatlab/node-runtime'

type SessionIndexRouteContext = Pick<RuntimeRouteContext, 'sessionAdapter'>

export function registerSessionIndexRoutes(server: FastifyInstance, ctx: SessionIndexRouteContext): void {
  const { sessionAdapter: adapter } = ctx

  server.get('/_web/sessions/index-stats', async () => {
    return sessionIndexService.getAllIndexStats(adapter)
  })

  server.post<{
    Params: { id: string }
    Body: { gapThreshold?: number }
  }>('/_web/sessions/:id/generate-index', async (request) => {
    const gapThreshold = (request.body as any)?.gapThreshold ?? 1800
    const sessionCount = sessionIndexService.generateIndex(adapter, request.params.id, gapThreshold)
    return { sessionCount }
  })

  server.post<{
    Params: { id: string }
    Body: { gapThreshold?: number }
  }>('/_web/sessions/:id/generate-incremental-index', async (request) => {
    const gapThreshold = (request.body as any)?.gapThreshold ?? 1800
    const sessionCount = sessionIndexService.generateIncrementalIndex(adapter, request.params.id, gapThreshold)
    return { sessionCount }
  })

  server.post<{ Params: { id: string } }>('/_web/sessions/:id/clear-index', async (request) => {
    sessionIndexService.clearIndex(adapter, request.params.id)
    return { success: true }
  })
}
