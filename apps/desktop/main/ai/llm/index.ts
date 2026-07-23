/**
 * LLM 服务模块入口
 * 提供统一的 LLM 服务管理（支持多配置）
 */

import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { getPathProvider } from '../../paths/provider'
import type { LLMProvider, ProviderInfo, AIServiceConfig, AIConfigStore } from './types'
import { MAX_CONFIG_COUNT } from './types'
import { aiLogger } from '../logger'
import { resolveApiKey, writeAuthProfile } from '@openchatlab/config'
import { buildChatLabUserAgentHeaders } from '../../utils/httpHeaders'
import { t } from '../../i18n'
import {
  buildPiModel as buildPiModelCore,
  fetchRemoteModels as fetchRemoteModelsCore,
  validateApiKey as validateApiKeyCore,
  type PiModel,
  type PiApi,
  type FetchRemoteModelsResult,
} from '@openchatlab/node-runtime'

export {
  loadCustomProviders,
  addCustomProvider,
  updateCustomProvider,
  deleteCustomProvider,
} from './custom-provider-store'
export { loadCustomModels, addCustomModel, updateCustomModel, deleteCustomModel } from './custom-model-store'
export * from './model-types'

// 兼容类型导出
export * from './types'

// ==================== 合并 Registry / Catalog（内置 + 自定义）====================

import { BUILTIN_PROVIDERS, getBuiltinProviderById } from '@openchatlab/core'
import { BUILTIN_MODELS, getBuiltinModelsByProvider } from '@openchatlab/core'
import { loadCustomProviders } from './custom-provider-store'
import { loadCustomModels } from './custom-model-store'
import type { ProviderDefinition, ModelDefinition } from './model-types'

/** 获取完整 provider registry（内置 + 自定义） */
export function getProviderRegistry(): ProviderDefinition[] {
  return [...BUILTIN_PROVIDERS, ...loadCustomProviders()]
}

/** 获取完整 model catalog（内置 + 自定义） */
export function getModelCatalog(): ModelDefinition[] {
  return [...BUILTIN_MODELS, ...loadCustomModels()]
}

/** 获取指定 provider 下的全部模型（内置 + 自定义） */
export function getModelsByProvider(providerId: string): ModelDefinition[] {
  return [...getBuiltinModelsByProvider(providerId), ...loadCustomModels().filter((m) => m.providerId === providerId)]
}

/** 按 id 查找 provider（内置优先） */
export function getProviderDefinitionById(id: string): ProviderDefinition | null {
  return getBuiltinProviderById(id) || loadCustomProviders().find((p) => p.id === id) || null
}

/** 按 providerId + modelId 查找模型定义（内置优先，再查自定义，最后跨 provider 兜底） */
export function findModelDefinition(providerId: string, modelId: string): ModelDefinition | null {
  return (
    getBuiltinModelById(providerId, modelId) ||
    loadCustomModels().find((m) => m.providerId === providerId && m.id === modelId) ||
    BUILTIN_MODELS.find((m) => m.id === modelId) ||
    loadCustomModels().find((m) => m.id === modelId) ||
    null
  )
}

function providerDefinitionToInfo(def: ProviderDefinition): ProviderInfo {
  const models = getBuiltinModelsByProvider(def.id)
  return {
    id: def.id,
    name: def.name,
    defaultBaseUrl: def.defaultBaseUrl,
    models: models
      .filter((m) => !m.capabilities.includes('embedding') && !m.capabilities.includes('ranking'))
      .map((m) => ({ id: m.id, name: m.name, description: m.description })),
  }
}

export const PROVIDERS: ProviderInfo[] = BUILTIN_PROVIDERS.map(providerDefinitionToInfo)

// 配置文件路径
let CONFIG_PATH: string | null = null

function getConfigPath(): string {
  if (CONFIG_PATH) return CONFIG_PATH
  CONFIG_PATH = path.join(getPathProvider().getAiDataDir(), 'llm-config.json')
  return CONFIG_PATH
}

// ==================== Electron-specific 增强迁移 ====================
// Migration Runner (packages/config/src/migrations) 处理核心数据迁移。
// 以下仅处理 Electron 特有的自定义 provider/model 注册（v2 迁移的补充步骤）。

import { addCustomProvider as _addCustomProviderDirect } from './custom-provider-store'
import { addCustomModel as _addCustomModelDirect } from './custom-model-store'
import { getBuiltinModelById } from '@openchatlab/core'

const LEGACY_PROVIDER_FALLBACKS: Record<string, { name: string; defaultBaseUrl: string }> = {
  minimax: { name: 'MiniMax', defaultBaseUrl: 'https://api.minimaxi.com/v1' },
}

function ensureCustomProvidersAndModels(configs: AIServiceConfig[]): void {
  for (const config of configs) {
    const providerId = config.provider

    if (!getBuiltinProviderById(providerId)) {
      const fallback = LEGACY_PROVIDER_FALLBACKS[providerId]
      if (fallback) {
        try {
          _addCustomProviderDirect({
            name: fallback.name,
            kind: 'openai-compatible',
            defaultBaseUrl: fallback.defaultBaseUrl,
            authMode: 'api-key',
            supportsCustomModels: true,
            modelIds: [],
          })
        } catch {
          // already exists
        }
      }
    }

    if (config.model && getBuiltinProviderById(providerId)) {
      if (!getBuiltinModelById(providerId, config.model)) {
        try {
          _addCustomModelDirect({
            id: config.model,
            providerId,
            name: config.model,
            capabilities: ['chat'],
            recommendedFor: ['chat'],
            status: 'stable',
          })
        } catch {
          // already exists
        }
      }
    }
  }
}

/** 解析 ModelSlot：如果 configId 无效，回退到 configs[0] */
function resolveSlot(
  slot: import('./model-types').ModelSlot | null | undefined,
  configs: AIServiceConfig[]
): import('./model-types').ModelSlot | null {
  if (slot && configs.some((c) => c.id === slot.configId)) return slot
  const fallback = configs[0]
  return fallback ? { configId: fallback.id, modelId: fallback.model || '' } : null
}

// ==================== 多配置管理 ====================

/**
 * 加载配置存储
 *
 * 数据迁移由 MigrationRunner 在应用启动时统一处理。
 * 此函数只读取最新格式，并从 auth-profiles.json 解析 API Key。
 */
export function loadConfigStore(): AIConfigStore {
  const configPath = getConfigPath()

  if (!fs.existsSync(configPath)) {
    return { configs: [], defaultAssistant: null, fastModel: null }
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8')
    const store = JSON.parse(content) as AIConfigStore

    ensureCustomProvidersAndModels(store.configs)

    const resolvedConfigs = store.configs.map((config) => {
      const profileKey = resolveApiKey(
        config.provider,
        (config as unknown as Record<string, unknown>).authProfile as string | undefined
      )
      return { ...config, apiKey: profileKey || config.apiKey || '' }
    })

    return {
      ...store,
      configs: resolvedConfigs,
      defaultAssistant: resolveSlot(store.defaultAssistant, resolvedConfigs),
      fastModel: resolveSlot(store.fastModel, resolvedConfigs),
    }
  } catch (error) {
    aiLogger.error('LLM', 'Failed to load configs', error)
    return { configs: [], defaultAssistant: null, fastModel: null }
  }
}

/**
 * 保存配置存储
 * API Key 不再存储在 llm-config.json 中，统一由 auth-profiles.json 管理
 */
export function saveConfigStore(store: AIConfigStore): void {
  saveConfigStoreRaw({
    ...store,
    configs: store.configs.map((config) => ({
      ...config,
      apiKey: '',
    })),
  })
}

function saveConfigStoreRaw(store: AIConfigStore): void {
  const configPath = getConfigPath()
  const dir = path.dirname(configPath)

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(configPath, JSON.stringify(store, null, 2), 'utf-8')
}

export function getAllConfigs(): AIServiceConfig[] {
  return loadConfigStore().configs
}

/** 获取默认助手 slot（含 configId + modelId） */
export function getDefaultAssistantSlot(): import('./model-types').ModelSlot | null {
  const store = loadConfigStore()
  return resolveSlot(store.defaultAssistant, store.configs)
}

/** 获取默认助手模型配置（AI 对话、工具调用、SQL 助手、上下文压缩）。自动覆盖 config.model 为 slot.modelId */
export function getDefaultAssistantConfig(): AIServiceConfig | null {
  const store = loadConfigStore()
  const slot = resolveSlot(store.defaultAssistant, store.configs)
  if (!slot) return null
  const config = store.configs.find((c) => c.id === slot.configId)
  if (!config) return null
  return { ...config, model: slot.modelId || config.model }
}

/** 获取快速模型 slot */
export function getFastModelSlot(): import('./model-types').ModelSlot | null {
  const store = loadConfigStore()
  if (store.fastModel === null) return null
  return resolveSlot(store.fastModel, store.configs)
}

/** 获取快速模型配置（会话摘要），未配置时回退到默认助手 */
export function getFastModelConfig(): AIServiceConfig | null {
  const store = loadConfigStore()
  if (store.fastModel === null) return getDefaultAssistantConfig()

  const slot = resolveSlot(store.fastModel, store.configs)
  if (slot) {
    const config = store.configs.find((c) => c.id === slot.configId)
    if (config) return { ...config, model: slot.modelId || config.model }
  }
  return getDefaultAssistantConfig()
}

export function getConfigById(id: string): AIServiceConfig | null {
  const store = loadConfigStore()
  return store.configs.find((c) => c.id === id) || null
}

export function addConfig(config: Omit<AIServiceConfig, 'id' | 'createdAt' | 'updatedAt'>): {
  success: boolean
  config?: AIServiceConfig
  error?: string
} {
  const store = loadConfigStore()

  if (store.configs.length >= MAX_CONFIG_COUNT) {
    return { success: false, error: t('llm.maxConfigs', { count: MAX_CONFIG_COUNT }) }
  }

  const now = Date.now()
  const newConfig: AIServiceConfig = {
    ...config,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
  }

  store.configs.push(newConfig)

  if (store.configs.length === 1) {
    store.defaultAssistant = { configId: newConfig.id, modelId: newConfig.model || '' }
  }

  if (newConfig.apiKey) {
    const profileName = newConfig.name?.toLowerCase().replace(/\s+/g, '-') || newConfig.provider
    writeAuthProfile(profileName, {
      type: 'api_key',
      provider: newConfig.provider,
      key: newConfig.apiKey,
    })
  }

  saveConfigStore(store)
  return { success: true, config: newConfig }
}

export function updateConfig(
  id: string,
  updates: Partial<Omit<AIServiceConfig, 'id' | 'createdAt' | 'updatedAt'>>
): { success: boolean; error?: string } {
  const store = loadConfigStore()
  const index = store.configs.findIndex((c) => c.id === id)

  if (index === -1) {
    return { success: false, error: t('llm.configNotFound') }
  }

  const updated = {
    ...store.configs[index],
    ...updates,
    updatedAt: Date.now(),
  }
  store.configs[index] = updated

  if (updates.apiKey) {
    const profileName = updated.name?.toLowerCase().replace(/\s+/g, '-') || updated.provider
    writeAuthProfile(profileName, {
      type: 'api_key',
      provider: updated.provider,
      key: updates.apiKey,
    })
  }

  saveConfigStore(store)
  return { success: true }
}

export function deleteConfig(id: string): { success: boolean; error?: string } {
  const store = loadConfigStore()
  const index = store.configs.findIndex((c) => c.id === id)

  if (index === -1) {
    return { success: false, error: t('llm.configNotFound') }
  }

  store.configs.splice(index, 1)

  const fallback = store.configs[0]
  if (store.defaultAssistant?.configId === id) {
    store.defaultAssistant = fallback ? { configId: fallback.id, modelId: fallback.model || '' } : null
  }
  if (store.fastModel?.configId === id) {
    store.fastModel = fallback ? { configId: fallback.id, modelId: fallback.model || '' } : null
  }

  saveConfigStore(store)
  return { success: true }
}

/** 设置默认助手模型（configId + modelId） */
export function setDefaultAssistantModel(configId: string, modelId: string): { success: boolean; error?: string } {
  const store = loadConfigStore()
  const config = store.configs.find((c) => c.id === configId)

  if (!config) {
    return { success: false, error: t('llm.configNotFound') }
  }

  store.defaultAssistant = { configId, modelId }
  saveConfigStore(store)
  return { success: true }
}

/** 设置快速模型（configId + modelId），传 null 表示跟随默认助手 */
export function setFastModel(slot: import('./model-types').ModelSlot | null): { success: boolean; error?: string } {
  const store = loadConfigStore()

  if (slot !== null) {
    const config = store.configs.find((c) => c.id === slot.configId)
    if (!config) {
      return { success: false, error: t('llm.configNotFound') }
    }
  }

  store.fastModel = slot
  saveConfigStore(store)
  return { success: true }
}

export function hasActiveConfig(): boolean {
  return getDefaultAssistantConfig() !== null
}

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
  return PROVIDERS.find((p) => p.id === provider) || null
}

// ==================== pi-ai Model 构建 ====================

export function buildPiModel(config: AIServiceConfig): PiModel<PiApi> {
  validateProviderBaseUrl(config.provider, config.baseUrl)

  return buildPiModelCore(config, {
    findModelFn: findModelDefinition,
    headers: config.provider === 'openai-compatible' ? buildChatLabUserAgentHeaders() : undefined,
  })
}

// ==================== Remote Model API ====================

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
