/**
 * 语义索引共享 Web 路由（Electron Internal API 与 CLI Web 复用）
 *
 * 入参以 sessionId 暴露，不暴露 db_path_hash。service 缺失时整组路由优雅跳过。
 * AI pipeline 直接调用 SemanticIndexService，不经过这些 HTTP 路由。
 */

import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { AiRouteContext } from '../../context/ai'
import type { SemanticIndexConfig } from '@openchatlab/node-runtime'
import {
  SemanticIndexConfigStore,
  SEMANTIC_INDEX_CONFIG_FILE,
  isSemanticIndexConfigured,
  persistSemanticIndexConfig,
  resolveSemanticIndexApiKeySet,
} from '@openchatlab/node-runtime'

type SemanticIndexRouteContext = Pick<
  AiRouteContext,
  'semanticIndexService' | 'aiDataDir' | 'resolveApiKey' | 'writeAuthProfile'
>

export function registerSemanticIndexRoutes(server: FastifyInstance, ctx: SemanticIndexRouteContext): void {
  const service = ctx.semanticIndexService

  // When the vector service is unavailable (e.g. sqlite-vec failed to load), register config
  // routes backed by the config-only store so the settings UI can still read/write configuration.
  if (!service) {
    if (ctx.aiDataDir) {
      const configStore = new SemanticIndexConfigStore(path.join(ctx.aiDataDir, SEMANTIC_INDEX_CONFIG_FILE))
      const configResponse = (config: SemanticIndexConfig) => ({
        config,
        apiKeySet: resolveSemanticIndexApiKeySet(config, ctx.resolveApiKey),
        configured: isSemanticIndexConfigured(config),
      })
      server.get('/_web/ai/semantic-index/config', async () => ({
        ...configResponse(configStore.get()),
        modelStatus: 'idle' as const,
      }))
      // 向量库不可用时仍允许写配置与 API Key（key 落 auth-profiles，不依赖向量库），
      // 否则 API 模式在降级期无法保存 key，恢复后会出现"已配置但无法检索"。
      server.put<{ Body: { config: SemanticIndexConfig; apiKey?: string } }>(
        '/_web/ai/semantic-index/config',
        async (request) => {
          const config = persistSemanticIndexConfig(configStore, request.body.config, {
            apiKey: request.body.apiKey,
            writeAuthProfile: ctx.writeAuthProfile,
          })
          return { ...configResponse(config), modelStatus: 'idle' as const }
        }
      )
    }
    server.get('/_web/ai/semantic-index/enabled', async () => ({ sessions: [] }))
    server.get('/_web/ai/semantic-index/status', async () => ({ status: null }))
    server.post('/_web/ai/semantic-index/status', async () => ({ sessions: [] }))
    return
  }

  server.get('/_web/ai/semantic-index/config', async () => {
    return {
      config: await service.getConfig(),
      apiKeySet: await service.hasApiKey(),
      configured: await service.isConfigured(),
      modelStatus: await service.getModelStatus(),
    }
  })

  server.put<{ Body: { config: SemanticIndexConfig; apiKey?: string } }>(
    '/_web/ai/semantic-index/config',
    async (request) => {
      const config = await service.setConfig(request.body.config, { apiKey: request.body.apiKey })
      return {
        config,
        apiKeySet: await service.hasApiKey(),
        configured: await service.isConfigured(),
        modelStatus: await service.getModelStatus(),
      }
    }
  )

  server.get('/_web/ai/semantic-index/enabled', async () => {
    return { sessions: await service.listEnabledStatuses() }
  })

  server.get<{ Querystring: { sessionId: string } }>('/_web/ai/semantic-index/status', async (request) => {
    return { status: await service.status(request.query.sessionId) }
  })

  server.post<{ Body: { sessionIds: string[] } }>('/_web/ai/semantic-index/status', async (request) => {
    return { sessions: await service.statusForSessions(request.body.sessionIds ?? []) }
  })

  const sessionAction = (path: string, action: (sessionId: string) => void | Promise<void>): void => {
    server.post<{ Body: { sessionId: string } }>(path, async (request, reply) => {
      const { sessionId } = request.body
      if (!sessionId) return reply.code(400).send({ error: 'sessionId is required' })
      await action(sessionId)
      return { status: await service.status(sessionId) }
    })
  }

  sessionAction('/_web/ai/semantic-index/enable', (id) => service.enable(id))
  sessionAction('/_web/ai/semantic-index/remove', (id) => service.remove(id))
  sessionAction('/_web/ai/semantic-index/build', (id) => service.build(id))
  sessionAction('/_web/ai/semantic-index/pause', (id) => service.pause(id))
  sessionAction('/_web/ai/semantic-index/cancel', (id) => service.cancel(id))
  sessionAction('/_web/ai/semantic-index/rebuild', (id) => service.rebuild(id))

  server.post('/_web/ai/semantic-index/build-pending', async () => {
    await service.buildAllPending()
    return { sessions: await service.listEnabledStatuses() }
  })

  server.post('/_web/ai/semantic-index/cleanup', async () => {
    return await service.cleanupUnused()
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
