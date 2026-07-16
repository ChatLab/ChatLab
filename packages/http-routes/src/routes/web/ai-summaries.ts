import type { FastifyInstance } from 'fastify'
import type { AiRouteContext } from '../../context/ai'
import type { RuntimeRouteContext } from '../../context/runtime'
import { summaryService, buildPiModel } from '@openchatlab/node-runtime'
import type { SummaryServiceDeps, LlmConfig, PiModelConfig } from '@openchatlab/node-runtime'

type AiSummaryRouteContext = Pick<RuntimeRouteContext, 'sessionAdapter'> & Pick<AiRouteContext, 'llmConfigStore'>

function createSummaryDeps(ctx: AiSummaryRouteContext): SummaryServiceDeps | null {
  const store = ctx.llmConfigStore
  if (!store) return null
  return {
    getLlmConfig(): LlmConfig | null {
      const config = store.getDefaultAssistantConfig()
      if (!config) return null
      return config
    },
    buildPiModel(config: LlmConfig) {
      return buildPiModel(config as unknown as PiModelConfig)
    },
  }
}

export function registerAiSummaryRoutes(server: FastifyInstance, ctx: AiSummaryRouteContext): void {
  const deps = createSummaryDeps(ctx)
  if (!deps) return

  const { sessionAdapter: adapter } = ctx

  server.post<{
    Params: { id: string }
    Body: { segmentId: number; locale?: string; forceRegenerate?: boolean; strategy?: 'brief' | 'standard' }
  }>('/_web/sessions/:id/summaries/generate', async (request, reply) => {
    const { segmentId, locale, forceRegenerate, strategy } = request.body
    const result = await summaryService.generateSummary(adapter, request.params.id, segmentId, deps, {
      locale,
      forceRegenerate,
      strategy,
    })
    if ('error' in result && !result.success) {
      return reply.code(400).send({ error: result.error })
    }
    return result
  })

  server.post<{
    Params: { id: string }
    Body: { locale?: string; forceRegenerate?: boolean }
  }>('/_web/sessions/:id/summaries/generate-all', async (request, reply) => {
    const { locale, forceRegenerate } = request.body
    const result = await summaryService.generateAllSummaries(adapter, request.params.id, deps, {
      locale,
      forceRegenerate,
    })
    if (result.error) {
      return reply.code(400).send({ error: result.error })
    }
    return result
  })

  server.post<{
    Params: { id: string }
    Body: { segmentIds: number[] }
  }>('/_web/sessions/:id/summaries/check-can-generate', async (request) => {
    const { segmentIds } = request.body
    return summaryService.checkCanGenerate(adapter, request.params.id, segmentIds)
  })
}
