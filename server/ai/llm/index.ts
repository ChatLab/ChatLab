/**
 * LLM service module (server-side)
 * Provides unified LLM service management with multi-config support.
 */

import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { getAiDataDir } from '../../paths.js'
import type { LLMProvider, ProviderInfo, AIServiceConfig, AIConfigStore } from './types.js'
import { MAX_CONFIG_COUNT } from './types.js'
import { aiLogger } from '../logger.js'
import { encryptApiKey, decryptApiKey, isEncrypted } from './crypto.js'
import { completeSimple, type Model as PiModel } from '@mariozechner/pi-ai'

// Re-export types
export * from './types.js'

// ==================== Provider definitions ====================

const DEEPSEEK_INFO: ProviderInfo = {
  id: 'deepseek',
  name: 'DeepSeek',
  description: 'DeepSeek AI 大语言模型',
  defaultBaseUrl: 'https://api.deepseek.com/v1',
  models: [
    { id: 'deepseek-chat', name: 'DeepSeek Chat', description: '通用对话模型' },
    { id: 'deepseek-coder', name: 'DeepSeek Coder', description: '代码生成模型' },
  ],
}

const QWEN_INFO: ProviderInfo = {
  id: 'qwen',
  name: '通义千问',
  description: '阿里云通义千问大语言模型',
  defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  models: [
    { id: 'qwen-turbo', name: 'Qwen Turbo', description: '通义千问超大规模语言模型，速度快' },
    { id: 'qwen-plus', name: 'Qwen Plus', description: '通义千问超大规模语言模型，效果好' },
    { id: 'qwen-max', name: 'Qwen Max', description: '通义千问千亿级别超大规模语言模型' },
  ],
}

const MINIMAX_INFO: ProviderInfo = {
  id: 'minimax',
  name: 'MiniMax',
  description: 'MiniMax 大语言模型，支持多模态和长上下文',
  defaultBaseUrl: 'https://api.minimaxi.com/v1',
  models: [
    { id: 'MiniMax-M2', name: 'MiniMax-M2', description: '旗舰模型' },
    { id: 'MiniMax-M2-Stable', name: 'MiniMax-M2-Stable', description: '稳定版本' },
  ],
}

const GLM_INFO: ProviderInfo = {
  id: 'glm',
  name: 'GLM',
  description: '智谱 AI 大语言模型，ChatGLM 系列',
  defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  models: [
    { id: 'glm-4-plus', name: 'GLM-4-Plus', description: '旗舰模型，效果最佳' },
    { id: 'glm-4-flash', name: 'GLM-4-Flash', description: '高速模型，性价比高' },
    { id: 'glm-4', name: 'GLM-4', description: '标准模型' },
    { id: 'glm-4v-plus', name: 'GLM-4V-Plus', description: '多模态视觉模型' },
    { id: 'glm-4.6v-flash', name: '4.6V免费版', description: '4.6V免费版模型' },
    { id: 'glm-4.5-flash', name: '4.5免费版', description: '4.5免费版模型' },
  ],
}

const KIMI_INFO: ProviderInfo = {
  id: 'kimi',
  name: 'Kimi',
  description: 'Moonshot AI 大语言模型，支持超长上下文',
  defaultBaseUrl: 'https://api.moonshot.cn/v1',
  models: [
    { id: 'moonshot-v1-8k', name: 'Moonshot-V1-8K', description: '8K 上下文' },
    { id: 'moonshot-v1-32k', name: 'Moonshot-V1-32K', description: '32K 上下文' },
    { id: 'moonshot-v1-128k', name: 'Moonshot-V1-128K', description: '128K 超长上下文' },
  ],
}

const DOUBAO_INFO: ProviderInfo = {
  id: 'doubao',
  name: '豆包',
  description: '字节跳动豆包 AI 大语言模型',
  defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  models: [
    { id: 'doubao-seed-1-6-lite-251015', name: '豆包1.6-lite', description: '豆包1.6模型，性价比' },
    { id: 'doubao-seed-1-6-251015', name: '豆包1.6', description: '更强豆包1.6模型' },
    { id: 'doubao-seed-1-6-flash-250828', name: '豆包1.6-flash', description: '更快的豆包1.6模型' },
    { id: 'doubao-1-5-lite-32k-250115', name: '豆包1.5-lite', description: '豆包1.5Pro模型模型' },
  ],
}

const GEMINI_INFO: ProviderInfo = {
  id: 'gemini',
  name: 'Gemini',
  description: 'Google Gemini 大语言模型',
  defaultBaseUrl: 'https://generativelanguage.googleapis.com',
  models: [
    { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', description: '高速预览版' },
    { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview', description: '专业预览版' },
  ],
}

const OPENAI_COMPATIBLE_INFO: ProviderInfo = {
  id: 'openai-compatible',
  name: 'OpenAI 兼容',
  description: '支持任何兼容 OpenAI API 的服务（如 Ollama、LocalAI、vLLM 等）',
  defaultBaseUrl: 'http://localhost:11434/v1',
  models: [
    { id: 'llama3.2', name: 'Llama 3.2', description: 'Meta Llama 3.2 模型' },
    { id: 'qwen2.5', name: 'Qwen 2.5', description: '通义千问 2.5 模型' },
    { id: 'deepseek-r1', name: 'DeepSeek R1', description: 'DeepSeek R1 推理模型' },
  ],
}

/** All supported providers */
export const PROVIDERS: ProviderInfo[] = [
  DEEPSEEK_INFO,
  QWEN_INFO,
  GEMINI_INFO,
  MINIMAX_INFO,
  GLM_INFO,
  KIMI_INFO,
  DOUBAO_INFO,
  OPENAI_COMPATIBLE_INFO,
]

// ==================== Config file path ====================

let CONFIG_PATH: string | null = null

function getConfigPath(): string {
  if (CONFIG_PATH) return CONFIG_PATH
  CONFIG_PATH = path.join(getAiDataDir(), 'llm-config.json')
  return CONFIG_PATH
}

/** Reset config path cache (for testing) */
export function _resetConfigPath(): void {
  CONFIG_PATH = null
}

// ==================== Legacy config migration ====================

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
  const newConfig: AIServiceConfig = {
    id: randomUUID(),
    name: getProviderInfo(legacy.provider)?.name || legacy.provider,
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

// ==================== Multi-config management ====================

/**
 * Load config store (handles migration and decryption).
 * Returned configs have API keys decrypted.
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

    const store = data as AIConfigStore

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

    if (needsEncryptionMigration) {
      aiLogger.info('LLM', 'Executing API Key encryption migration')
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
 * Save config store (auto-encrypts API keys).
 * Input configs should have plaintext API keys.
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

/** Get all configs */
export function getAllConfigs(): AIServiceConfig[] {
  return loadConfigStore().configs
}

/** Get the active config */
export function getActiveConfig(): AIServiceConfig | null {
  const store = loadConfigStore()
  if (!store.activeConfigId) return null
  return store.configs.find((c) => c.id === store.activeConfigId) || null
}

/** Get a single config by ID */
export function getConfigById(id: string): AIServiceConfig | null {
  const store = loadConfigStore()
  return store.configs.find((c) => c.id === id) || null
}

/** Add a new config */
export function addConfig(config: Omit<AIServiceConfig, 'id' | 'createdAt' | 'updatedAt'>): {
  success: boolean
  config?: AIServiceConfig
  error?: string
} {
  const store = loadConfigStore()

  if (store.configs.length >= MAX_CONFIG_COUNT) {
    return { success: false, error: `Maximum ${MAX_CONFIG_COUNT} configs allowed` }
  }

  const now = Date.now()
  const newConfig: AIServiceConfig = {
    ...config,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
  }

  store.configs.push(newConfig)

  // Auto-activate if this is the first config
  if (store.configs.length === 1) {
    store.activeConfigId = newConfig.id
  }

  saveConfigStore(store)
  return { success: true, config: newConfig }
}

/** Update an existing config */
export function updateConfig(
  id: string,
  updates: Partial<Omit<AIServiceConfig, 'id' | 'createdAt' | 'updatedAt'>>
): { success: boolean; error?: string } {
  const store = loadConfigStore()
  const index = store.configs.findIndex((c) => c.id === id)

  if (index === -1) {
    return { success: false, error: 'Config not found' }
  }

  store.configs[index] = {
    ...store.configs[index],
    ...updates,
    updatedAt: Date.now(),
  }

  saveConfigStore(store)
  return { success: true }
}

/** Delete a config */
export function deleteConfig(id: string): { success: boolean; error?: string } {
  const store = loadConfigStore()
  const index = store.configs.findIndex((c) => c.id === id)

  if (index === -1) {
    return { success: false, error: 'Config not found' }
  }

  store.configs.splice(index, 1)

  if (store.activeConfigId === id) {
    store.activeConfigId = store.configs.length > 0 ? store.configs[0].id : null
  }

  saveConfigStore(store)
  return { success: true }
}

/** Set the active config */
export function setActiveConfig(id: string): { success: boolean; error?: string } {
  const store = loadConfigStore()
  const config = store.configs.find((c) => c.id === id)

  if (!config) {
    return { success: false, error: 'Config not found' }
  }

  store.activeConfigId = id
  saveConfigStore(store)
  return { success: true }
}

/** Check whether there is an active config */
export function hasActiveConfig(): boolean {
  const config = getActiveConfig()
  return config !== null
}

/**
 * Validate provider base URL format.
 */
function validateProviderBaseUrl(provider: LLMProvider, baseUrl?: string): void {
  if (!baseUrl) return

  const normalized = baseUrl.replace(/\/+$/, '')

  if (provider === 'deepseek') {
    if (normalized.endsWith('/chat/completions')) {
      throw new Error('DeepSeek Base URL should end at /v1, do not include /chat/completions')
    }
    if (!normalized.endsWith('/v1')) {
      throw new Error('DeepSeek Base URL must end with /v1')
    }
  }

  if (provider === 'qwen') {
    if (normalized.endsWith('/chat/completions')) {
      throw new Error('Qwen Base URL should end at /v1, do not include /chat/completions')
    }
    if (!normalized.endsWith('/v1')) {
      throw new Error('Qwen Base URL must end with /v1')
    }
    if (normalized.includes('dashscope.aliyuncs.com') && !normalized.includes('/compatible-mode/')) {
      throw new Error('Qwen Base URL must include /compatible-mode/v1')
    }
  }
}

/** Get provider information by ID */
export function getProviderInfo(provider: LLMProvider): ProviderInfo | null {
  return PROVIDERS.find((p) => p.id === provider) || null
}

// ==================== pi-ai Model building ====================

/**
 * Convert AIServiceConfig to a pi-ai Model object.
 */
export function buildPiModel(config: AIServiceConfig): PiModel<'openai-completions'> | PiModel<'google-generative-ai'> {
  const providerInfo = getProviderInfo(config.provider)
  const baseUrl = config.baseUrl || providerInfo?.defaultBaseUrl || ''
  const modelId = config.model || providerInfo?.models?.[0]?.id || ''

  validateProviderBaseUrl(config.provider, baseUrl)

  if (config.provider === 'gemini') {
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

  return {
    id: modelId,
    name: modelId,
    api: 'openai-completions',
    provider: config.provider,
    baseUrl,
    reasoning: config.isReasoningModel ?? false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: config.maxTokens ?? 4096,
    compat: config.disableThinking ? { thinkingFormat: 'qwen' } : undefined,
  }
}

/**
 * Validate an API Key by sending a minimal request via pi-ai completeSimple.
 */
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
      await completeSimple(
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
