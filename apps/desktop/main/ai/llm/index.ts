/**
 * Desktop LLM runtime integration.
 *
 * Configuration persistence is owned by @openchatlab/node-runtime so Desktop,
 * CLI, and CLI Web use the same files and behavior under ~/.chatlab/ai.
 */

import {
  BUILTIN_MODELS,
  BUILTIN_PROVIDERS,
  getBuiltinModelById,
  getBuiltinModelsByProvider,
  getBuiltinProviderById,
  type ModelDefinition,
  type ProviderDefinition,
} from '@openchatlab/core'
import {
  buildPiModel as buildPiModelCore,
  createLlmRuntimeStores,
  fetchRemoteModels as fetchRemoteModelsCore,
  validateApiKey as validateApiKeyCore,
  type AIServiceConfig,
  type FetchRemoteModelsResult,
  type LlmRuntimeStores,
  type PiApi,
  type PiModel,
} from '@openchatlab/node-runtime'
import { getPathProvider } from '../../paths/provider'
import { buildChatLabUserAgentHeaders } from '../../utils/httpHeaders'
import { t } from '../../i18n'
import { aiLogger } from '../logger'
import type { LLMProvider, ProviderInfo } from './types'

export * from './model-types'
export * from './types'

let runtime:
  | {
      aiDataDir: string
      stores: LlmRuntimeStores
    }
  | undefined

export function getDesktopLlmRuntimeStores(aiDataDir = getPathProvider().getAiDataDir()): LlmRuntimeStores {
  if (!runtime || runtime.aiDataDir !== aiDataDir) {
    runtime = {
      aiDataDir,
      stores: createLlmRuntimeStores(aiDataDir, {
        t: (key, options) => t(key, options),
      }),
    }
  }
  return runtime.stores
}

export function getProviderRegistry(): ProviderDefinition[] {
  return [...BUILTIN_PROVIDERS, ...getDesktopLlmRuntimeStores().customProviderStore.getAll()]
}

export function getModelCatalog(): ModelDefinition[] {
  return [...BUILTIN_MODELS, ...getDesktopLlmRuntimeStores().customModelStore.getAll()]
}

export function getModelsByProvider(providerId: string): ModelDefinition[] {
  return [
    ...getBuiltinModelsByProvider(providerId),
    ...getDesktopLlmRuntimeStores()
      .customModelStore.getAll()
      .filter((model) => model.providerId === providerId),
  ]
}

export function getProviderDefinitionById(id: string): ProviderDefinition | null {
  return (
    getBuiltinProviderById(id) ||
    getDesktopLlmRuntimeStores()
      .customProviderStore.getAll()
      .find((provider) => provider.id === id) ||
    null
  )
}

export function findModelDefinition(providerId: string, modelId: string): ModelDefinition | null {
  const customModels = getDesktopLlmRuntimeStores().customModelStore.getAll()
  return (
    getBuiltinModelById(providerId, modelId) ||
    customModels.find((model) => model.providerId === providerId && model.id === modelId) ||
    BUILTIN_MODELS.find((model) => model.id === modelId) ||
    customModels.find((model) => model.id === modelId) ||
    null
  )
}

function providerDefinitionToInfo(definition: ProviderDefinition): ProviderInfo {
  const models = getBuiltinModelsByProvider(definition.id)
  return {
    id: definition.id,
    name: definition.name,
    defaultBaseUrl: definition.defaultBaseUrl,
    models: models
      .filter((model) => !model.capabilities.includes('embedding') && !model.capabilities.includes('ranking'))
      .map((model) => ({ id: model.id, name: model.name, description: model.description })),
  }
}

export const PROVIDERS: ProviderInfo[] = BUILTIN_PROVIDERS.map(providerDefinitionToInfo)

function validateProviderBaseUrl(provider: LLMProvider, baseUrl?: string): void {
  if (!baseUrl) return

  const normalized = baseUrl.replace(/\/+$/, '')

  if (provider === 'deepseek') {
    if (normalized.endsWith('/chat/completions')) {
      throw new Error('DeepSeek Base URL 请填写到 /v1 层级，不要包含 /chat/completions')
    }
    if (!normalized.endsWith('/v1')) {
      throw new Error('DeepSeek Base URL 需要以 /v1 结尾')
    }
  }

  if (provider === 'qwen') {
    if (normalized.endsWith('/chat/completions')) {
      throw new Error('通义千问 Base URL 请填写到 /v1 层级，不要包含 /chat/completions')
    }
    if (!normalized.endsWith('/v1')) {
      throw new Error('通义千问 Base URL 需要以 /v1 结尾')
    }
    if (normalized.includes('dashscope.aliyuncs.com') && !normalized.includes('/compatible-mode/')) {
      throw new Error('通义千问 Base URL 需要包含 /compatible-mode/v1')
    }
  }
}

export function getProviderInfo(provider: LLMProvider): ProviderInfo | null {
  return PROVIDERS.find((item) => item.id === provider) || null
}

export function buildPiModel(config: AIServiceConfig): PiModel<PiApi> {
  validateProviderBaseUrl(config.provider, config.baseUrl)

  return buildPiModelCore(config, {
    findModelFn: findModelDefinition,
    headers: config.provider === 'openai-compatible' ? buildChatLabUserAgentHeaders() : undefined,
  })
}

const electronRemoteApiOptions = () => ({
  headers: buildChatLabUserAgentHeaders(),
  onLog: (level: 'info' | 'error', tag: string, message: string, data?: unknown) => {
    if (level === 'error') aiLogger.error(tag, message, data)
    else aiLogger.info(tag, message, data)
  },
})

export async function fetchRemoteModels(
  provider: string,
  apiKey: string,
  baseUrl?: string,
  apiFormat?: string
): Promise<FetchRemoteModelsResult> {
  return fetchRemoteModelsCore(provider, apiKey, baseUrl, apiFormat, electronRemoteApiOptions())
}

export async function validateApiKey(
  provider: LLMProvider,
  apiKey: string,
  baseUrl?: string,
  model?: string
): Promise<{ success: boolean; error?: string }> {
  return validateApiKeyCore(provider, apiKey, baseUrl, model, undefined, electronRemoteApiOptions())
}
