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

  server.get<{
    Params: { id: string }
    Querystring: { keywords: string; limit?: string; offset?: string }
  }>('/_web/sessions/:id/search/fts', async (request, reply) => {
    if (!sessionIndexService.getFtsStatus(adapter, request.params.id)) {
      return reply.code(400).send({ error: 'FTS index not built for this session' })
    }
    const keywords = request.query.keywords.split(/\s+/).filter(Boolean)
    if (keywords.length === 0) return { rowids: [], total: 0 }
    const limit = parseInt(request.query.limit || '100', 10)
    const offset = parseInt(request.query.offset || '0', 10)
    return sessionIndexService.searchFts(adapter, request.params.id, keywords, limit, offset)
  })

  server.get<{ Params: { id: string } }>('/_web/sessions/:id/fts/status', async (request) => {
    return { hasFtsIndex: sessionIndexService.getFtsStatus(adapter, request.params.id) }
  })

  server.post<{ Params: { id: string } }>('/_web/sessions/:id/fts/rebuild', async (request) => {
    const result = sessionIndexService.rebuildFts(adapter, request.params.id)
    return { success: true, indexed: result.indexed }
  })
}
