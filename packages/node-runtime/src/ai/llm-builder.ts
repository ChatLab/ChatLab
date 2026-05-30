/**
 * Shared PiModel builder — translates an AIServiceConfig-like
 * object into a PiModel instance for @earendil-works/pi-ai.
 *
 * Used by both Electron and Server to eliminate duplicated
 * URL normalization, apiFormat mapping, and model construction.
 */

import { BUILTIN_PROVIDERS, getBuiltinModelsByProvider, BUILTIN_MODELS, type ModelDefinition } from '@openchatlab/core'
import type { Model as PiModel, Api as PiApi } from '@earendil-works/pi-ai'

export interface PiModelConfig {
  provider: string
  model?: string
  baseUrl?: string
  maxTokens?: number
  apiFormat?: string
}

export interface BuildPiModelOptions {
  /** Override model definition lookup (e.g. to include custom models). */
  findModelFn?: (providerId: string, modelId: string) => ModelDefinition | null
  /** Extra headers injected into the PiModel (e.g. User-Agent). */
  headers?: Record<string, string>
}

/**
 * Strip /v1 suffix from Anthropic baseUrl because the SDK
 * internally appends /v1/messages.
 */
export function normalizeAnthropicBaseUrl(url: string): string {
  return url.replace(/\/v1\/?$/, '')
}

/**
 * Auto-append /v1 to OpenAI-compatible URLs when the path is empty
 * (users frequently forget this).
 */
export function normalizeOpenAICompatibleBaseUrl(url: string): string {
  if (!url) return url
  const trimmed = url.replace(/\/+$/, '')
  if (trimmed.endsWith('/v1')) return trimmed
  try {
    const parsed = new URL(trimmed)
    if (parsed.pathname === '/' || parsed.pathname === '') {
      return trimmed + '/v1'
    }
  } catch {
    // URL parse failure — return as-is
  }
  return trimmed
}

const DEFAULT_CONTEXT_WINDOW = 128000

function defaultFindModel(providerId: string, modelId: string): ModelDefinition | null {
  const forProvider = getBuiltinModelsByProvider(providerId)
  return forProvider.find((m) => m.id === modelId) || BUILTIN_MODELS.find((m) => m.id === modelId) || null
}

const BUILTIN_PROVIDER_API: Record<string, PiApi> = {
  gemini: 'google-generative-ai',
  anthropic: 'anthropic-messages',
}

/**
 * Infer whether a model should have reasoning enabled and which
 * thinking format to use, based on the model catalog and provider.
 *
 * - reasoning: true when the catalog marks the model as 'reasoning' capable,
 *   or (for custom/unlisted models) when the model id matches a known pattern.
 * - compat.thinkingFormat 'qwen': only for Qwen-family endpoints (official
 *   DashScope provider or model id containing "qwen"/"qwq"). Other providers
 *   must never receive `enable_thinking` in the request body.
 */
function inferReasoning(
  provider: string,
  modelId: string,
  modelDef: ModelDefinition | null,
): { reasoning: boolean; compat: PiModel<PiApi>['compat'] } {
  // Catalog is the authoritative source; fall back to heuristic for unlisted
  // custom/self-hosted models where modelDef is null.
  const reasoning = modelDef
    ? modelDef.capabilities.includes('reasoning')
    : /qwen3|qwq|deepseek-r|r1\b|o1\b|o3\b|thinking|reasoning/i.test(modelId)

  if (!reasoning) return { reasoning: false, compat: undefined }

  // Qwen-family: official DashScope provider id OR model name containing qwen/qwq.
  const isQwen = provider === 'qwen' || /qwen|qwq/i.test(modelId)
  return {
    reasoning: true,
    compat: isQwen ? { thinkingFormat: 'qwen' } : undefined,
  }
}

export function buildPiModel(config: PiModelConfig, options?: BuildPiModelOptions): PiModel<PiApi> {
  const providerDef = BUILTIN_PROVIDERS.find((p) => p.id === config.provider)
  const baseUrl = config.baseUrl || providerDef?.defaultBaseUrl || ''
  const modelId = config.model || ''

  const findModel = options?.findModelFn ?? defaultFindModel
  const modelDef = findModel(config.provider, modelId)
  const contextWindow = modelDef?.contextWindow ?? DEFAULT_CONTEXT_WINDOW

  const apiFormat: PiApi = (config.apiFormat as PiApi) || BUILTIN_PROVIDER_API[config.provider] || 'openai-completions'

  if (apiFormat === 'google-generative-ai') {
    return {
      id: modelId,
      name: modelId,
      api: 'google-generative-ai',
      provider: 'google',
      baseUrl,
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow,
      maxTokens: config.maxTokens ?? 8192,
    }
  }

  if (apiFormat === 'anthropic-messages') {
    return {
      id: modelId,
      name: modelId,
      api: 'anthropic-messages',
      provider: 'anthropic',
      baseUrl: normalizeAnthropicBaseUrl(baseUrl),
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow,
      maxTokens: config.maxTokens ?? 8192,
    }
  }

  const resolvedBaseUrl =
    config.provider === 'openai-compatible' && (apiFormat === 'openai-completions' || apiFormat === 'openai-responses')
      ? normalizeOpenAICompatibleBaseUrl(baseUrl)
      : baseUrl

  const { reasoning, compat } = inferReasoning(config.provider, modelId, modelDef)

  return {
    id: modelId,
    name: modelId,
    api: apiFormat,
    provider: config.provider,
    baseUrl: resolvedBaseUrl,
    headers: options?.headers,
    reasoning,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: config.maxTokens ?? 4096,
    compat,
  }
}
