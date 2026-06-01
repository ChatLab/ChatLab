import type { FastifyInstance } from 'fastify'
import type { HttpRouteContext } from '../../context'
import { BUILTIN_PROVIDERS, BUILTIN_MODELS, getBuiltinModelsByProvider } from '@openchatlab/core'
import {
  validateApiKey,
  fetchRemoteModels,
  getDefaultRulesForLocale,
  mergeRulesForLocale,
} from '@openchatlab/node-runtime'

// ==================== API key display masking ====================

function hasRealApiKey(apiKey: string): boolean {
  return !!apiKey && apiKey !== 'sk-no-key-required'
}

function toConfigDisplay(config: Record<string, unknown>): Record<string, unknown> {
  const { apiKey: _raw, ...rest } = config
  return { ...rest, apiKey: '', apiKeySet: hasRealApiKey(String(_raw || '')) }
}

// ==================== Route registration ====================

export function registerAiLlmRoutes(server: FastifyInstance, ctx: HttpRouteContext): void {
  const store = ctx.llmConfigStore
  const aiDataDir = ctx.aiDataDir
  if (!store || !aiDataDir) return

  // ---------- Config CRUD ----------

  server.get('/_web/ai/llm/has-config', async () => {
    return store.hasActiveConfig()
  })

  server.get('/_web/ai/llm/configs', async () => {
    const data = store.loadStore()
    return {
      configs: data.configs.map((c) => toConfigDisplay(c as unknown as Record<string, unknown>)),
      defaultAssistant: data.defaultAssistant,
      fastModel: data.fastModel,
    }
  })

  server.post<{
    Body: {
      name: string
      provider: string
      apiKey: string
      model?: string
      baseUrl?: string
      maxTokens?: number
      apiFormat?: string
      customModels?: Array<{ id: string; name: string }>
    }
  }>('/_web/ai/llm/configs', async (request) => {
    const result = store.addConfig(request.body)
    if (result.success && result.config) {
      return { ...result, config: toConfigDisplay(result.config as unknown as Record<string, unknown>) }
    }
    return result
  })

  server.put<{
    Params: { id: string }
    Body: {
      name?: string
      provider?: string
      apiKey?: string
      model?: string
      baseUrl?: string
      maxTokens?: number
      apiFormat?: string
      customModels?: Array<{ id: string; name: string }>
    }
  }>('/_web/ai/llm/configs/:id', async (request) => {
    return store.updateConfig(request.params.id, request.body)
  })

  server.delete<{ Params: { id: string } }>('/_web/ai/llm/configs/:id', async (request) => {
    return store.deleteConfig(request.params.id)
  })

  server.get('/_web/ai/llm/default-assistant-slot', async () => {
    return store.getDefaultAssistantSlot()
  })

  server.put<{
    Body: { configId: string; modelId: string }
  }>('/_web/ai/llm/default-assistant-slot', async (request) => {
    return store.setDefaultAssistantModel(request.body.configId, request.body.modelId)
  })

  server.get('/_web/ai/llm/fast-model-slot', async () => {
    return store.getFastModelSlot()
  })

  server.put<{
    Body: { configId: string; modelId: string } | null
  }>('/_web/ai/llm/fast-model-slot', async (request) => {
    return store.setFastModel(request.body)
  })

  // ---------- Provider Registry & Model Catalog ----------

  server.get('/_web/ai/llm/providers', async () => {
    return BUILTIN_PROVIDERS.map((p) => {
      const models = getBuiltinModelsByProvider(p.id)
      return {
        id: p.id,
        name: p.name,
        defaultBaseUrl: p.defaultBaseUrl,
        models: models
          .filter((m) => !m.capabilities.includes('embedding') && !m.capabilities.includes('ranking'))
          .map((m) => ({ id: m.id, name: m.name, description: m.description })),
      }
    })
  })

  server.get('/_web/ai/llm/provider-registry', async () => {
    const custom = ctx.customProviderStore?.getAll() ?? []
    return [...BUILTIN_PROVIDERS, ...custom]
  })

  server.get('/_web/ai/llm/model-catalog', async () => {
    const custom = ctx.customModelStore?.getAll() ?? []
    return [...BUILTIN_MODELS, ...custom]
  })

  // ---------- Custom Provider CRUD ----------

  server.post<{
    Body: {
      name: string
      kind: string
      defaultBaseUrl: string
      supportsCustomModels?: boolean
      modelIds?: string[]
      website?: string
      consoleUrl?: string
    }
  }>('/_web/ai/llm/custom-providers', async (request, reply) => {
    if (!ctx.customProviderStore)
      return reply.code(501).send({ success: false, error: 'Custom providers not available' })
    return ctx.customProviderStore.add(request.body)
  })

  server.put<{
    Params: { id: string }
    Body: Record<string, unknown>
  }>('/_web/ai/llm/custom-providers/:id', async (request, reply) => {
    if (!ctx.customProviderStore)
      return reply.code(501).send({ success: false, error: 'Custom providers not available' })
    const result = ctx.customProviderStore.update(request.params.id, request.body as any)
    if (!result.success) return reply.code(404).send(result)
    return result
  })

  server.delete<{ Params: { id: string } }>('/_web/ai/llm/custom-providers/:id', async (request, reply) => {
    if (!ctx.customProviderStore)
      return reply.code(501).send({ success: false, error: 'Custom providers not available' })
    const result = ctx.customProviderStore.delete(request.params.id)
    if (!result.success) return reply.code(404).send(result)
    return result
  })

  // ---------- Custom Model CRUD ----------

  server.post<{
    Body: {
      id: string
      providerId: string
      name: string
      description?: string
      contextWindow?: number
      capabilities?: string[]
      recommendedFor?: string[]
      status?: string
    }
  }>('/_web/ai/llm/custom-models', async (request, reply) => {
    if (!ctx.customModelStore) return reply.code(501).send({ success: false, error: 'Custom models not available' })
    const result = ctx.customModelStore.add(request.body)
    if (!result.success) return reply.code(409).send(result)
    return result
  })

  server.put<{
    Params: { providerId: string; modelId: string }
    Body: Record<string, unknown>
  }>('/_web/ai/llm/custom-models/:providerId/:modelId', async (request, reply) => {
    if (!ctx.customModelStore) return reply.code(501).send({ success: false, error: 'Custom models not available' })
    const result = ctx.customModelStore.update(request.params.providerId, request.params.modelId, request.body as any)
    if (!result.success) return reply.code(404).send(result)
    return result
  })

  server.delete<{
    Params: { providerId: string; modelId: string }
  }>('/_web/ai/llm/custom-models/:providerId/:modelId', async (request, reply) => {
    if (!ctx.customModelStore) return reply.code(501).send({ success: false, error: 'Custom models not available' })
    const result = ctx.customModelStore.delete(request.params.providerId, request.params.modelId)
    if (!result.success) return reply.code(404).send(result)
    return result
  })

  // ---------- Remote API ----------

  server.post<{
    Body: { provider: string; apiKey: string; baseUrl?: string; model?: string; apiFormat?: string }
  }>('/_web/ai/llm/validate-key', async (request) => {
    const { provider, apiKey, baseUrl, model, apiFormat } = request.body
    return validateApiKey(provider, apiKey, baseUrl, model, apiFormat)
  })

  server.post<{
    Body: { provider: string; apiKey: string; baseUrl?: string; apiFormat?: string }
  }>('/_web/ai/llm/remote-models', async (request) => {
    const { provider, apiKey, baseUrl, apiFormat } = request.body
    return fetchRemoteModels(provider, apiKey, baseUrl, apiFormat)
  })

  // ---------- Desensitize Rules ----------

  server.get<{
    Querystring: { locale?: string }
  }>('/_web/ai/desensitize-rules/defaults', async (request) => {
    return getDefaultRulesForLocale(request.query.locale ?? 'zh-CN')
  })

  server.post<{
    Body: { existingRules: unknown[]; locale: string }
  }>('/_web/ai/desensitize-rules/merge', async (request) => {
    return mergeRulesForLocale(request.body.existingRules as any[], request.body.locale)
  })
}
