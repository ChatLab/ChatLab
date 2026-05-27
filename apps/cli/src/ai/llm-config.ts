/**
 * 服务端 LLM 配置加载
 *
 * API Key 从 ~/.chatlab/auth-profiles.json 读取，
 * 匹配顺序：config.authProfile 精确匹配 > config.provider 兜底匹配。
 *
 * 模型/Provider 等配置仍从 llm-config.json 读取。
 */

import * as fs from 'fs'
import * as path from 'path'
import type { PiModel, PiApi } from '@openchatlab/node-runtime'
import { buildPiModel as buildPiModelCore, type PiModelConfig } from '@openchatlab/node-runtime'
import { resolveApiKey, writeAuthProfile } from '@openchatlab/config'
import { randomUUID } from 'crypto'

// ==================== Types ====================

export interface AIServiceConfig {
  id: string
  name: string
  provider: string
  apiKey: string
  model?: string
  baseUrl?: string
  maxTokens?: number
  apiFormat?: string
  disableThinking?: boolean
  isReasoningModel?: boolean
  customModels?: Array<{ id: string; name: string }>
  authProfile?: string
}

interface ModelSlot {
  configId: string
  modelId?: string
}

interface AIConfigStore {
  configs: AIServiceConfig[]
  defaultAssistant: ModelSlot | null
  fastModel: ModelSlot | null
}

// ==================== Config Loading ====================

export function loadLlmConfig(aiDataDir: string): AIConfigStore {
  const configPath = path.join(aiDataDir, 'llm-config.json')
  if (!fs.existsSync(configPath)) {
    return { configs: [], defaultAssistant: null, fastModel: null }
  }

  try {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'))

    const configs = (data.configs || []).map((c: Record<string, unknown>) => {
      const provider = (c.provider as string) || ''
      const authProfile = c.authProfile as string | undefined
      const profileKey = resolveApiKey(provider, authProfile)
      const rawKey = (c.apiKey as string) || ''
      const fallbackKey = rawKey.startsWith('enc:') ? '' : rawKey
      return {
        ...c,
        apiKey: profileKey || fallbackKey,
      }
    })
    return {
      configs,
      defaultAssistant: data.defaultAssistant ?? null,
      fastModel: data.fastModel ?? null,
    }
  } catch {
    return { configs: [], defaultAssistant: null, fastModel: null }
  }
}

function resolveSlot(slot: ModelSlot | null | undefined, configs: AIServiceConfig[]): ModelSlot | null {
  if (slot && configs.some((c) => c.id === slot.configId)) return slot
  const fallback = configs[0]
  if (!fallback) return null
  return { configId: fallback.id, modelId: fallback.model }
}

export function getDefaultAssistantConfig(aiDataDir: string): AIServiceConfig | null {
  const store = loadLlmConfig(aiDataDir)
  const slot = resolveSlot(store.defaultAssistant, store.configs)
  if (!slot) return null
  const config = store.configs.find((c) => c.id === slot.configId)
  if (!config) return null
  return { ...config, model: slot.modelId || config.model }
}

// ==================== Config Write Operations ====================

const MAX_CONFIG_COUNT = 99

function saveLlmConfig(aiDataDir: string, store: AIConfigStore): void {
  const configPath = path.join(aiDataDir, 'llm-config.json')
  const toSave = {
    ...store,
    configs: store.configs.map((c) => {
      const { apiKey: _k, ...rest } = c
      return rest
    }),
    schemaVersion: 3,
  }
  fs.writeFileSync(configPath, JSON.stringify(toSave, null, 2), 'utf-8')
}

export function addLlmConfig(
  aiDataDir: string,
  config: Omit<AIServiceConfig, 'id'>
): { success: boolean; config?: AIServiceConfig; error?: string } {
  const store = loadLlmConfig(aiDataDir)

  if (store.configs.length >= MAX_CONFIG_COUNT) {
    return { success: false, error: `Maximum ${MAX_CONFIG_COUNT} configs reached` }
  }

  const newConfig: AIServiceConfig = {
    ...config,
    id: randomUUID(),
  }

  const storeForSave = loadRawConfigStore(aiDataDir)
  storeForSave.configs.push({
    ...newConfig,
    apiKey: '',
  })

  if (storeForSave.configs.length === 1) {
    storeForSave.defaultAssistant = { configId: newConfig.id, modelId: newConfig.model || '' }
  }

  if (config.apiKey) {
    const profileName = config.name?.toLowerCase().replace(/\s+/g, '-') || config.provider
    writeAuthProfile(profileName, {
      type: 'api_key',
      provider: config.provider,
      key: config.apiKey,
    })
    ;(storeForSave.configs[storeForSave.configs.length - 1] as unknown as Record<string, unknown>).authProfile =
      profileName
  }

  saveLlmConfig(aiDataDir, storeForSave)
  return { success: true, config: { ...newConfig, apiKey: '' } }
}

export function updateLlmConfig(
  aiDataDir: string,
  id: string,
  updates: Partial<Omit<AIServiceConfig, 'id'>>
): { success: boolean; error?: string } {
  const storeForSave = loadRawConfigStore(aiDataDir)
  const index = storeForSave.configs.findIndex((c) => c.id === id)

  if (index === -1) {
    return { success: false, error: 'Config not found' }
  }

  const { apiKey: newApiKey, ...restUpdates } = updates
  const updated = {
    ...storeForSave.configs[index],
    ...restUpdates,
  }
  storeForSave.configs[index] = updated

  if (newApiKey) {
    const profileName = updated.name?.toLowerCase().replace(/\s+/g, '-') || updated.provider
    writeAuthProfile(profileName, {
      type: 'api_key',
      provider: updated.provider,
      key: newApiKey,
    })
    ;(storeForSave.configs[index] as unknown as Record<string, unknown>).authProfile = profileName
  }

  saveLlmConfig(aiDataDir, storeForSave)
  return { success: true }
}

export function deleteLlmConfig(aiDataDir: string, id: string): { success: boolean; error?: string } {
  const storeForSave = loadRawConfigStore(aiDataDir)
  const index = storeForSave.configs.findIndex((c) => c.id === id)

  if (index === -1) {
    return { success: false, error: 'Config not found' }
  }

  storeForSave.configs.splice(index, 1)

  const fallback = storeForSave.configs[0]
  if (storeForSave.defaultAssistant?.configId === id) {
    storeForSave.defaultAssistant = fallback ? { configId: fallback.id, modelId: fallback.model || '' } : null
  }
  if (storeForSave.fastModel?.configId === id) {
    storeForSave.fastModel = fallback ? { configId: fallback.id, modelId: fallback.model || '' } : null
  }

  saveLlmConfig(aiDataDir, storeForSave)
  return { success: true }
}

export function setDefaultAssistantSlot(
  aiDataDir: string,
  configId: string,
  modelId: string
): { success: boolean; error?: string } {
  const storeForSave = loadRawConfigStore(aiDataDir)
  const config = storeForSave.configs.find((c) => c.id === configId)

  if (!config) {
    return { success: false, error: 'Config not found' }
  }

  storeForSave.defaultAssistant = { configId, modelId }
  saveLlmConfig(aiDataDir, storeForSave)
  return { success: true }
}

export function setFastModelSlot(aiDataDir: string, slot: ModelSlot | null): { success: boolean; error?: string } {
  const storeForSave = loadRawConfigStore(aiDataDir)

  if (slot !== null) {
    const config = storeForSave.configs.find((c) => c.id === slot.configId)
    if (!config) {
      return { success: false, error: 'Config not found' }
    }
  }

  storeForSave.fastModel = slot
  saveLlmConfig(aiDataDir, storeForSave)
  return { success: true }
}

function loadRawConfigStore(aiDataDir: string): AIConfigStore {
  const configPath = path.join(aiDataDir, 'llm-config.json')
  if (!fs.existsSync(configPath)) {
    return { configs: [], defaultAssistant: null, fastModel: null }
  }
  try {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    return {
      configs: data.configs || [],
      defaultAssistant: data.defaultAssistant ?? null,
      fastModel: data.fastModel ?? null,
    }
  } catch {
    return { configs: [], defaultAssistant: null, fastModel: null }
  }
}

// ==================== PiModel Builder ====================

export function buildPiModel(config: AIServiceConfig): PiModel<PiApi> {
  return buildPiModelCore(config as PiModelConfig)
}
