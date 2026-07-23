/**
 * Custom provider/model persistence — platform-agnostic.
 * Uses ConfigStorage abstraction so both CLI and Electron share the same logic.
 */

import type { ConfigStorage } from './llm-config-store'
import type { ProviderDefinition, ModelDefinition } from '@openchatlab/core'

function generateCustomId(): string {
  return `custom:${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export class CustomProviderStore {
  constructor(private storage: ConfigStorage) {}

  private withLock<T>(action: () => T): T {
    return this.storage.withLock ? this.storage.withLock('custom-providers', action) : action()
  }

  getAll(): ProviderDefinition[] {
    return this.storage.readJson<ProviderDefinition[]>('custom-providers') ?? []
  }

  add(input: {
    name: string
    kind?: string
    defaultBaseUrl: string
    supportsCustomModels?: boolean
    modelIds?: string[]
    website?: string
    consoleUrl?: string
  }): ProviderDefinition {
    return this.withLock(() => {
      const providers = this.getAll()
      const newProvider: ProviderDefinition = {
        id: generateCustomId(),
        name: input.name,
        kind: (input.kind || 'openai-compatible') as ProviderDefinition['kind'],
        defaultBaseUrl: input.defaultBaseUrl,
        authMode: 'api-key',
        supportsCustomModels: input.supportsCustomModels ?? true,
        modelIds: input.modelIds ?? [],
        builtin: false,
        enabledByDefault: false,
        website: input.website,
        consoleUrl: input.consoleUrl,
      }
      providers.push(newProvider)
      this.storage.writeJson('custom-providers', providers)
      return newProvider
    })
  }

  update(id: string, updates: Partial<ProviderDefinition>): { success: boolean; error?: string } {
    return this.withLock(() => {
      const providers = this.getAll()
      const index = providers.findIndex((p) => p.id === id)
      if (index === -1) return { success: false, error: 'Custom provider not found' }
      providers[index] = { ...providers[index], ...updates }
      this.storage.writeJson('custom-providers', providers)
      return { success: true }
    })
  }

  delete(id: string): { success: boolean; error?: string } {
    return this.withLock(() => {
      const providers = this.getAll()
      const index = providers.findIndex((p) => p.id === id)
      if (index === -1) return { success: false, error: 'Custom provider not found' }
      providers.splice(index, 1)
      this.storage.writeJson('custom-providers', providers)
      return { success: true }
    })
  }
}

export class CustomModelStore {
  constructor(private storage: ConfigStorage) {}

  private withLock<T>(action: () => T): T {
    return this.storage.withLock ? this.storage.withLock('custom-models', action) : action()
  }

  getAll(): ModelDefinition[] {
    return this.storage.readJson<ModelDefinition[]>('custom-models') ?? []
  }

  add(input: {
    id: string
    providerId: string
    name: string
    description?: string
    contextWindow?: number
    capabilities?: string[]
    recommendedFor?: string[]
    status?: string
  }): { success: boolean; model?: ModelDefinition; error?: string } {
    return this.withLock(() => {
      const models = this.getAll()
      if (models.find((m) => m.id === input.id && m.providerId === input.providerId)) {
        return {
          success: false,
          error: `Model "${input.id}" already exists under provider "${input.providerId}"`,
        }
      }
      const newModel: ModelDefinition = {
        id: input.id,
        providerId: input.providerId,
        name: input.name,
        description: input.description,
        contextWindow: input.contextWindow,
        capabilities: (input.capabilities ?? ['chat']) as ModelDefinition['capabilities'],
        recommendedFor: (input.recommendedFor ?? ['chat']) as ModelDefinition['recommendedFor'],
        status: (input.status ?? 'stable') as ModelDefinition['status'],
        builtin: false,
        editable: true,
      }
      models.push(newModel)
      this.storage.writeJson('custom-models', models)
      return { success: true, model: newModel }
    })
  }

  update(providerId: string, modelId: string, updates: Partial<ModelDefinition>): { success: boolean; error?: string } {
    return this.withLock(() => {
      const models = this.getAll()
      const index = models.findIndex((m) => m.id === modelId && m.providerId === providerId)
      if (index === -1) return { success: false, error: 'Custom model not found' }
      models[index] = { ...models[index], ...updates }
      this.storage.writeJson('custom-models', models)
      return { success: true }
    })
  }

  delete(providerId: string, modelId: string): { success: boolean; error?: string } {
    return this.withLock(() => {
      const models = this.getAll()
      const index = models.findIndex((m) => m.id === modelId && m.providerId === providerId)
      if (index === -1) return { success: false, error: 'Custom model not found' }
      models.splice(index, 1)
      this.storage.writeJson('custom-models', models)
      return { success: true }
    })
  }
}
