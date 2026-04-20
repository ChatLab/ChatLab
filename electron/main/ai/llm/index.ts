/**
 * LLM 服务模块入口
 * 提供统一的 LLM 服务管理（支持多配置）
 */

import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { getAiDataDir } from '../../paths'
import type { LLMProvider, ProviderInfo, AIServiceConfig, AIConfigStore } from './types'
import { MAX_CONFIG_COUNT } from './types'
import { aiLogger } from '../logger'
import { encryptApiKey, decryptApiKey, isEncrypted } from './crypto'
import { buildChatLabUserAgentHeaders } from '../../utils/httpHeaders'
import { t } from '../../i18n'
import { completeSimple, type Model as PiModel, type Api as PiApi } from '@mariozechner/pi-ai'

// 新模型系统导出
export { BUILTIN_PROVIDERS, getBuiltinProviderById } from './provider-registry'
export { BUILTIN_MODELS, getBuiltinModelsByProvider, getBuiltinModelById } from './model-catalog'
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

import { BUILTIN_PROVIDERS, getBuiltinProviderById } from './provider-registry'
import { BUILTIN_MODELS, getBuiltinModelsByProvider } from './model-catalog'
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

/**
 * 所有 provider 信息（兼容旧格式）
 * @deprecated 使用 BUILTIN_PROVIDERS 代替
 */
export const PROVIDERS: ProviderInfo[] = BUILTIN_PROVIDERS.map(providerDefinitionToInfo)

// 配置文件路径
let CONFIG_PATH: string | null = null

function getConfigPath(): string {
  if (CONFIG_PATH) return CONFIG_PATH
  CONFIG_PATH = path.join(getAiDataDir(), 'llm-config.json')
  return CONFIG_PATH
}

// ==================== 旧配置格式（用于迁移）====================

interface LegacyStoredConfig {
  provider: LLMProvider
  apiKey: string
  model?: string
  maxTokens?: number
}

function isLegacyConfig(data: unknown): data is LegacyStoredConfig {
  if (!data || typeof data !== 'object') return false
  const obj = data as Record<string, unknown>
  return 'provider' in obj && 'apiKey' in obj && !('configs' in obj)
}

function migrateLegacyConfig(legacy: LegacyStoredConfig): AIConfigStore {
  const now = Date.now()
  const providerDef = getBuiltinProviderById(legacy.provider)
  const newConfig: AIServiceConfig = {
    id: randomUUID(),
    name: providerDef?.name || legacy.provider,
    provider: legacy.provider,
    apiKey: legacy.apiKey,
    model: legacy.model,
    maxTokens: legacy.maxTokens,
    createdAt: now,
    updatedAt: now,
  }

  return {
    configs: [newConfig],
    activeConfigId: newConfig.id,
  }
}

// ==================== Schema 版本迁移 ====================

import { addCustomProvider as _addCustomProviderDirect } from './custom-provider-store'
import { addCustomModel as _addCustomModelDirect } from './custom-model-store'
import { getBuiltinModelById } from './model-catalog'

const CURRENT_SCHEMA_VERSION = 2

/**
 * MiniMax 等旧 provider 的兼容映射表
 * 这些旧 provider 不在新 BUILTIN_PROVIDERS 中，需要自动迁移为自定义 provider
 */
const LEGACY_PROVIDER_FALLBACKS: Record<string, { name: string; defaultBaseUrl: string }> = {
  minimax: { name: 'MiniMax', defaultBaseUrl: 'https://api.minimaxi.com/v1' },
}

/**
 * 将旧 AIConfigStore (schemaVersion=1 或无) 迁移到 schemaVersion=2
 * - provider 在新 registry 中存在 → 保持不变
 * - provider 不存在 → 自动创建自定义 provider
 * - model 不在 catalog 中 → 自动创建自定义 model
 * - disableThinking / isReasoningModel → 不迁移（兼容期通过 compat 字段保留）
 */
function migrateToSchemaV2(store: AIConfigStore): AIConfigStore {
  aiLogger.info('LLM', 'Migrating config store to schema v2')

  for (const config of store.configs) {
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
          aiLogger.info('LLM', `Created custom provider for legacy provider: ${providerId}`)
        } catch {
          // already exists
        }
      }
    }

    if (config.model && getBuiltinProviderById(providerId)) {
      const modelInCatalog = getBuiltinModelById(providerId, config.model)
      if (!modelInCatalog) {
        try {
          _addCustomModelDirect({
            id: config.model,
            providerId,
            name: config.model,
            capabilities: ['chat'],
            recommendedFor: ['chat'],
            status: 'stable',
          })
          aiLogger.info('LLM', `Created custom model "${config.model}" under provider "${providerId}"`)
        } catch {
          // already exists
        }
      }
    }
  }

  return {
    ...store,
    configs: store.configs.map((c) => {
      const { disableThinking: _dt, isReasoningModel: _rm, ...rest } = c as AIServiceConfig & Record<string, unknown>
      return rest as AIServiceConfig
    }),
  }
}

// ==================== 多配置管理 ====================

/**
 * 加载配置存储（自动处理迁移和解密）
 */
export function loadConfigStore(): AIConfigStore {
  const configPath = getConfigPath()

  if (!fs.existsSync(configPath)) {
    return { configs: [], activeConfigId: null }
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8')
    const data = JSON.parse(content)

    if (isLegacyConfig(data)) {
      aiLogger.info('LLM', 'Old config format detected, migrating')
      const migrated = migrateLegacyConfig(data)
      saveConfigStore(migrated)
      return loadConfigStore()
    }

    let store = data as AIConfigStore & { schemaVersion?: number }

    // Schema v1 → v2 迁移
    if (!store.schemaVersion || store.schemaVersion < CURRENT_SCHEMA_VERSION) {
      store = { ...migrateToSchemaV2(store), schemaVersion: CURRENT_SCHEMA_VERSION } as typeof store
      // 先解密再保存（migrateToSchemaV2 不改 apiKey 格式）
    }

    let needsEncryptionMigration = false
    const decryptedConfigs = store.configs.map((config) => {
      if (config.apiKey && !isEncrypted(config.apiKey)) {
        needsEncryptionMigration = true
        aiLogger.info('LLM', `Config "${config.name}" API Key needs encryption migration`)
      }
      return {
        ...config,
        apiKey: config.apiKey ? decryptApiKey(config.apiKey) : '',
      }
    })

    if (needsEncryptionMigration || (!data.schemaVersion && store.schemaVersion)) {
      aiLogger.info('LLM', 'Saving migrated config store')
      saveConfigStoreRaw({
        ...store,
        configs: store.configs.map((config) => ({
          ...config,
          apiKey: config.apiKey ? encryptApiKey(decryptApiKey(config.apiKey)) : '',
        })),
      })
    }

    return {
      ...store,
      configs: decryptedConfigs,
    }
  } catch (error) {
    aiLogger.error('LLM', 'Failed to load configs', error)
    return { configs: [], activeConfigId: null }
  }
}

/**
 * 保存配置存储（自动加密 API Key）
 */
export function saveConfigStore(store: AIConfigStore): void {
  const encryptedStore: AIConfigStore = {
    ...store,
    configs: store.configs.map((config) => ({
      ...config,
      apiKey: config.apiKey ? encryptApiKey(config.apiKey) : '',
    })),
  }
  saveConfigStoreRaw(encryptedStore)
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

export function getActiveConfig(): AIServiceConfig | null {
  const store = loadConfigStore()
  if (!store.activeConfigId) return null
  return store.configs.find((c) => c.id === store.activeConfigId) || null
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
    store.activeConfigId = newConfig.id
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

  store.configs[index] = {
    ...store.configs[index],
    ...updates,
    updatedAt: Date.now(),
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

  if (store.activeConfigId === id) {
    store.activeConfigId = store.configs.length > 0 ? store.configs[0].id : null
  }

  saveConfigStore(store)
  return { success: true }
}

export function setActiveConfig(id: string): { success: boolean; error?: string } {
  const store = loadConfigStore()
  const config = store.configs.find((c) => c.id === id)

  if (!config) {
    return { success: false, error: t('llm.configNotFound') }
  }

  store.activeConfigId = id
  saveConfigStore(store)
  return { success: true }
}

export function hasActiveConfig(): boolean {
  const config = getActiveConfig()
  return config !== null
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

/**
 * 获取提供商信息（兼容旧调用）
 * @deprecated 使用 getBuiltinProviderById 代替
 */
export function getProviderInfo(provider: LLMProvider): ProviderInfo | null {
  return PROVIDERS.find((p) => p.id === provider) || null
}

// ==================== pi-ai Model 构建 ====================

/**
 * 规范化 Anthropic baseUrl：Anthropic SDK 内部会拼接 /v1/messages，
 * 因此 baseUrl 不应包含 /v1 后缀，否则会导致 /v1/v1/messages 双重路径。
 */
function normalizeAnthropicBaseUrl(url: string): string {
  return url.replace(/\/v1\/?$/, '')
}

export function buildPiModel(config: AIServiceConfig): PiModel<PiApi> {
  const providerDef = getBuiltinProviderById(config.provider)
  const providerInfo = getProviderInfo(config.provider)
  const baseUrl = config.baseUrl || providerDef?.defaultBaseUrl || providerInfo?.defaultBaseUrl || ''
  const modelId = config.model || providerInfo?.models?.[0]?.id || ''

  validateProviderBaseUrl(config.provider, baseUrl)

  const BUILTIN_PROVIDER_API: Record<string, PiApi> = {
    gemini: 'google-generative-ai',
    anthropic: 'anthropic-messages',
  }

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
      contextWindow: 1048576,
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
      contextWindow: 200000,
      maxTokens: config.maxTokens ?? 8192,
    }
  }

  return {
    id: modelId,
    name: modelId,
    api: apiFormat,
    provider: config.provider,
    baseUrl,
    headers: config.provider === 'openai-compatible' ? buildChatLabUserAgentHeaders() : undefined,
    reasoning: config.isReasoningModel ?? false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: config.maxTokens ?? 4096,
    compat: config.disableThinking ? { thinkingFormat: 'qwen' } : undefined,
  }
}

export async function validateApiKey(
  provider: LLMProvider,
  apiKey: string,
  baseUrl?: string,
  model?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const providerInfo = getProviderInfo(provider)
    const config: AIServiceConfig = {
      id: 'validate-temp',
      name: 'validate-temp',
      provider,
      apiKey,
      baseUrl,
      model: model || providerInfo?.models?.[0]?.id,
      createdAt: 0,
      updatedAt: 0,
    }
    const piModel = buildPiModel(config)

    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(), 15000)

    try {
      const result = await completeSimple(
        piModel,
        {
          messages: [{ role: 'user', content: 'Hi', timestamp: Date.now() }],
        },
        {
          apiKey,
          maxTokens: 1,
          signal: abortController.signal,
        }
      )
      if (result.stopReason === 'error' || result.stopReason === 'aborted') {
        return { success: false, error: result.errorMessage || 'Connection failed' }
      }
      return { success: true }
    } finally {
      clearTimeout(timeout)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('aborted') || message.includes('AbortError')) {
      return { success: false, error: 'Request timed out (15s)' }
    }
    return { success: false, error: message }
  }
}
