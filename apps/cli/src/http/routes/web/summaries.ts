import type { FastifyInstance } from 'fastify'
import type { DatabaseManager, SessionRuntimeAdapter, SummaryServiceDeps } from '@openchatlab/node-runtime'
import { summaryService } from '@openchatlab/node-runtime'
import { getAiDataDir } from './helpers'
import { getDefaultAssistantConfig, buildPiModel } from '../../../ai/llm-config'

function createSummaryDeps(dbManager: DatabaseManager): SummaryServiceDeps {
  const aiDataDir = getAiDataDir(dbManager)
  return {
    getLlmConfig() {
      return getDefaultAssistantConfig(aiDataDir)
    },
    buildPiModel(config) {
      return buildPiModel(config as ReturnType<typeof getDefaultAssistantConfig> & object)
    },
  }
}

export function registerSummaryRoutes(
  server: FastifyInstance,
  dbManager: DatabaseManager,
  adapter: SessionRuntimeAdapter
): void {
  const deps = createSummaryDeps(dbManager)

  server.post<{
    Params: { id: string }
    Body: { chatSessionId: number; locale?: string; forceRegenerate?: boolean }
  }>('/_web/sessions/:id/summaries/generate', async (request, reply) => {
    const { chatSessionId, locale, forceRegenerate } = request.body
    const result = await summaryService.generateSummary(adapter, request.params.id, chatSessionId, deps, {
      locale,
      forceRegenerate,
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
}
