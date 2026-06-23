/**
 * LLM configuration CRUD store — platform-agnostic.
 * Uses ConfigStorage abstraction for persistence and dependency injection
 * for i18n, UUID generation, and auth profile management.
 */

import type { ModelSlot } from '@openchatlab/core'

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
  customModels?: Array<{ id: string; name: string }>
  createdAt: number
  updatedAt: number
}

export interface AIConfigStore {
  configs: AIServiceConfig[]
  defaultAssistant: ModelSlot | null
  fastModel: ModelSlot | null
}

export const MAX_CONFIG_COUNT = 99

// ==================== Storage abstraction ====================

export interface ConfigStorage {
  readJson<T>(key: string): T | null
  writeJson<T>(key: string, data: T): void
}

// ==================== Dependencies ====================

export interface LLMConfigStoreDeps {
  t?: (key: string, options?: Record<string, unknown>) => string
  generateId?: () => string
  /** Returns the auth profile name so LLMConfigStore can persist it on the config */
  onApiKeyCreated?: (config: AIServiceConfig, apiKey: string) => string | void
  /** Called after a config is removed; use to clean up the corresponding auth profile */
  onApiKeyDeleted?: (config: AIServiceConfig) => void
  resolveApiKey?: (provider: string, authProfile?: string) => string | undefined
  onStoreLoaded?: (configs: AIServiceConfig[]) => void
}

// ==================== Config Store ====================

function defaultT(key: string, options?: Record<string, unknown>): string {
  if (key === 'llm.maxConfigs' && options?.count) return `Maximum ${options.count} configurations allowed`
  if (key === 'llm.configNotFound') return 'Configuration not found'
  return key
}

function defaultGenerateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function resolveSlot(slot: ModelSlot | null | undefined, configs: AIServiceConfig[]): ModelSlot | null {
  if (slot && configs.some((c) => c.id === slot.configId)) return slot
  const fallback = configs[0]
  return fallback ? { configId: fallback.id, modelId: fallback.model || '' } : null
}

function getAuthProfile(config: AIServiceConfig): string | undefined {
  return (config as unknown as Record<string, unknown>).authProfile as string | undefined
}

function isAuthProfileUsed(configs: AIServiceConfig[], authProfile: string, profileProvider?: string): boolean {
  return configs.some((config) => {
    const configAuthProfile = getAuthProfile(config)
    if (configAuthProfile === authProfile) return true
    return !configAuthProfile && profileProvider !== undefined && config.provider === profileProvider
  })
}

export class LLMConfigStore {
  private storage: ConfigStorage
  private t: (key: string, options?: Record<string, unknown>) => string
  private generateId: () => string
  private onApiKeyCreated?: (config: AIServiceConfig, apiKey: string) => string | void
  private onApiKeyDeleted?: (config: AIServiceConfig) => void
  private resolveApiKey?: (provider: string, authProfile?: string) => string | undefined
  private onStoreLoaded?: (configs: AIServiceConfig[]) => void

  constructor(storage: ConfigStorage, deps: LLMConfigStoreDeps = {}) {
    this.storage = storage
    this.t = deps.t || defaultT
    this.generateId = deps.generateId || defaultGenerateId
    this.onApiKeyCreated = deps.onApiKeyCreated
    this.onApiKeyDeleted = deps.onApiKeyDeleted
    this.resolveApiKey = deps.resolveApiKey
    this.onStoreLoaded = deps.onStoreLoaded
  }

  loadStore(): AIConfigStore {
    const store = this.storage.readJson<AIConfigStore>('llm-config')
    if (!store) {
      return { configs: [], defaultAssistant: null, fastModel: null }
    }

    this.onStoreLoaded?.(store.configs)

    const resolvedConfigs = this.resolveApiKey
      ? store.configs.map((config) => {
          const profileKey = this.resolveApiKey!(
            config.provider,
            (config as unknown as Record<string, unknown>).authProfile as string | undefined
          )
          return { ...config, apiKey: profileKey || config.apiKey || '' }
        })
      : store.configs

    return {
      ...store,
      configs: resolvedConfigs,
      defaultAssistant: resolveSlot(store.defaultAssistant, resolvedConfigs),
      fastModel: resolveSlot(store.fastModel, resolvedConfigs),
    }
  }

  saveStore(store: AIConfigStore): void {
    this.storage.writeJson<AIConfigStore>('llm-config', {
      ...store,
      configs: store.configs.map((config) => ({
        ...config,
        apiKey: '',
      })),
    })
  }

  getAllConfigs(): AIServiceConfig[] {
    return this.loadStore().configs
  }

  getDefaultAssistantSlot(): ModelSlot | null {
    const store = this.loadStore()
    return resolveSlot(store.defaultAssistant, store.configs)
  }

  getDefaultAssistantConfig(): AIServiceConfig | null {
    const store = this.loadStore()
    const slot = resolveSlot(store.defaultAssistant, store.configs)
    if (!slot) return null
    const config = store.configs.find((c) => c.id === slot.configId)
    if (!config) return null
    return { ...config, model: slot.modelId || config.model }
  }

  getFastModelSlot(): ModelSlot | null {
    const store = this.loadStore()
    if (store.fastModel === null) return null
    return resolveSlot(store.fastModel, store.configs)
  }

  getFastModelConfig(): AIServiceConfig | null {
    const store = this.loadStore()
    if (store.fastModel === null) return this.getDefaultAssistantConfig()

    const slot = resolveSlot(store.fastModel, store.configs)
    if (slot) {
      const config = store.configs.find((c) => c.id === slot.configId)
      if (config) return { ...config, model: slot.modelId || config.model }
    }
    return this.getDefaultAssistantConfig()
  }

  getConfigById(id: string): AIServiceConfig | null {
    const store = this.loadStore()
    return store.configs.find((c) => c.id === id) || null
  }

  addConfig(config: Omit<AIServiceConfig, 'id' | 'createdAt' | 'updatedAt'>): {
    success: boolean
    config?: AIServiceConfig
    error?: string
  } {
    const store = this.loadStore()

    if (store.configs.length >= MAX_CONFIG_COUNT) {
      return { success: false, error: this.t('llm.maxConfigs', { count: MAX_CONFIG_COUNT }) }
    }

    const now = Date.now()
    const newConfig: AIServiceConfig = {
      ...config,
      id: this.generateId(),
      createdAt: now,
      updatedAt: now,
    }

    store.configs.push(newConfig)

    if (store.configs.length === 1) {
      store.defaultAssistant = { configId: newConfig.id, modelId: newConfig.model || '' }
    }

    if (newConfig.apiKey && this.onApiKeyCreated) {
      const profileName = this.onApiKeyCreated(newConfig, newConfig.apiKey)
      if (profileName) {
        ;(newConfig as unknown as Record<string, unknown>).authProfile = profileName
      }
    }

    this.saveStore(store)
    return { success: true, config: { ...newConfig, apiKey: '' } }
  }

  updateConfig(
    id: string,
    updates: Partial<Omit<AIServiceConfig, 'id' | 'createdAt' | 'updatedAt'>>
  ): { success: boolean; error?: string } {
    const store = this.loadStore()
    const index = store.configs.findIndex((c) => c.id === id)

    if (index === -1) {
      return { success: false, error: this.t('llm.configNotFound') }
    }

    const oldConfig = store.configs[index]
    const oldProfileName = (oldConfig as unknown as Record<string, unknown>).authProfile as string | undefined

    const updated = {
      ...oldConfig,
      ...updates,
      updatedAt: Date.now(),
    }
    store.configs[index] = updated
    let oldProfileToDelete: AIServiceConfig | null = null

    if (updates.apiKey && this.onApiKeyCreated) {
      const profileName = this.onApiKeyCreated(updated, updates.apiKey)
      if (profileName) {
        ;(store.configs[index] as unknown as Record<string, unknown>).authProfile = profileName
        if (
          oldProfileName &&
          oldProfileName !== profileName &&
          !isAuthProfileUsed(store.configs, oldProfileName, oldConfig.provider)
        ) {
          oldProfileToDelete = oldConfig
        }
      }
    }

    this.saveStore(store)
    if (oldProfileToDelete) this.onApiKeyDeleted?.(oldProfileToDelete)
    return { success: true }
  }

  deleteConfig(id: string): { success: boolean; error?: string } {
    const store = this.loadStore()
    const index = store.configs.findIndex((c) => c.id === id)

    if (index === -1) {
      return { success: false, error: this.t('llm.configNotFound') }
    }

    const deleted = store.configs[index]
    store.configs.splice(index, 1)

    const fallback = store.configs[0]
    if (store.defaultAssistant?.configId === id) {
      store.defaultAssistant = fallback ? { configId: fallback.id, modelId: fallback.model || '' } : null
    }
    if (store.fastModel?.configId === id) {
      store.fastModel = fallback ? { configId: fallback.id, modelId: fallback.model || '' } : null
    }

    this.saveStore(store)
    const deletedProfileName = getAuthProfile(deleted)
    if (!deletedProfileName || !isAuthProfileUsed(store.configs, deletedProfileName, deleted.provider)) {
      this.onApiKeyDeleted?.(deleted)
    }
    return { success: true }
  }

  setDefaultAssistantModel(configId: string, modelId: string): { success: boolean; error?: string } {
    const store = this.loadStore()
    const config = store.configs.find((c) => c.id === configId)

    if (!config) {
      return { success: false, error: this.t('llm.configNotFound') }
    }

    store.defaultAssistant = { configId, modelId }
    this.saveStore(store)
    return { success: true }
  }

  setFastModel(slot: ModelSlot | null): { success: boolean; error?: string } {
    const store = this.loadStore()

    if (slot !== null) {
      const config = store.configs.find((c) => c.id === slot.configId)
      if (!config) {
        return { success: false, error: this.t('llm.configNotFound') }
      }
    }

    store.fastModel = slot
    this.saveStore(store)
    return { success: true }
  }

  hasActiveConfig(): boolean {
    return this.getDefaultAssistantConfig() !== null
  }
}
