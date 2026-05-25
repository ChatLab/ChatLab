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
  disableThinking?: boolean
  isReasoningModel?: boolean
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

  return {
    id: modelId,
    name: modelId,
    api: apiFormat,
    provider: config.provider,
    baseUrl: resolvedBaseUrl,
    headers: options?.headers,
    reasoning: config.isReasoningModel ?? false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: config.maxTokens ?? 4096,
    compat: config.disableThinking ? { thinkingFormat: 'qwen' } : undefined,
  }
}
