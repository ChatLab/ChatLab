/**
 * 语义索引共享 Web 路由（Electron Internal API 与 CLI Web 复用）
 *
 * 入参以 sessionId 暴露，不暴露 db_path_hash。service 缺失时整组路由优雅跳过。
 * AI pipeline 直接调用 SemanticIndexService，不经过这些 HTTP 路由。
 */

import type { FastifyInstance } from 'fastify'
import type { HttpRouteContext } from '../../context'
import type { SemanticIndexConfig } from '@openchatlab/node-runtime'

export function registerSemanticIndexRoutes(server: FastifyInstance, ctx: HttpRouteContext): void {
  const service = ctx.semanticIndexService
  if (!service) return

  server.get('/_web/ai/semantic-index/config', async () => {
    return { config: service.getConfig(), apiKeySet: service.hasApiKey(), configured: service.isConfigured() }
  })

  server.put<{ Body: { config: SemanticIndexConfig; apiKey?: string } }>(
    '/_web/ai/semantic-index/config',
    async (request) => {
      const config = service.setConfig(request.body.config, { apiKey: request.body.apiKey })
      return { config, apiKeySet: service.hasApiKey(), configured: service.isConfigured() }
    }
  )

  server.get('/_web/ai/semantic-index/enabled', async () => {
    return { sessions: service.listEnabledStatuses() }
  })

  server.get<{ Querystring: { sessionId: string } }>('/_web/ai/semantic-index/status', async (request) => {
    return { status: service.status(request.query.sessionId) }
  })

  server.post<{ Body: { sessionIds: string[] } }>('/_web/ai/semantic-index/status', async (request) => {
    return { sessions: service.statusForSessions(request.body.sessionIds ?? []) }
  })

  const sessionAction = (path: string, action: (sessionId: string) => void | Promise<void>): void => {
    server.post<{ Body: { sessionId: string } }>(path, async (request, reply) => {
      const { sessionId } = request.body
      if (!sessionId) return reply.code(400).send({ error: 'sessionId is required' })
      await action(sessionId)
      return { status: service.status(sessionId) }
    })
  }

  sessionAction('/_web/ai/semantic-index/enable', (id) => service.enable(id))
  sessionAction('/_web/ai/semantic-index/disable', (id) => service.disable(id))
  sessionAction('/_web/ai/semantic-index/build', (id) => service.build(id))
  sessionAction('/_web/ai/semantic-index/pause', (id) => service.pause(id))
  sessionAction('/_web/ai/semantic-index/cancel', (id) => service.cancel(id))
  sessionAction('/_web/ai/semantic-index/rebuild', (id) => service.rebuild(id))

  server.post('/_web/ai/semantic-index/build-pending', async () => {
    service.buildAllPending()
    return { sessions: service.listEnabledStatuses() }
  })

  server.post('/_web/ai/semantic-index/cleanup', async () => {
    return service.cleanupUnused()
  })

  server.post<{ Body: { sessionId: string; query: string; finalTopK?: number } }>(
    '/_web/ai/semantic-index/search',
    async (request, reply) => {
      const { sessionId, query, finalTopK } = request.body
      if (!sessionId || !query) return reply.code(400).send({ error: 'sessionId and query are required' })
      return service.search(sessionId, query, { finalTopK })
    }
  )
}
