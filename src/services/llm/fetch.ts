import type {
  LLMServiceAdapter,
  AIServiceConfigDisplay,
  AIServiceConfigInput,
  ModelSlot,
  LLMConfigStore,
  LLMProvider,
  ProviderRegistryItem,
  ModelCatalogItem,
  CustomProviderInput,
  CustomModelInput,
} from './types'
import { get, post, put, del } from '../utils/http'

export class FetchLLMAdapter implements LLMServiceAdapter {
  async hasConfig(): Promise<boolean> {
    return get<boolean>('/ai/llm/has-config')
  }

  async getConfigStore(): Promise<LLMConfigStore> {
    return get<LLMConfigStore>('/ai/llm/configs')
  }

  async getAllConfigs(): Promise<AIServiceConfigDisplay[]> {
    const store = await this.getConfigStore()
    return store.configs
  }

  async getDefaultAssistantSlot(): Promise<ModelSlot | null> {
    return get<ModelSlot | null>('/ai/llm/default-assistant-slot')
  }

  async getFastModelSlot(): Promise<ModelSlot | null> {
    return get<ModelSlot | null>('/ai/llm/fast-model-slot')
  }

  async setDefaultAssistantModel(configId: string, modelId: string) {
    return put<{ success: boolean; error?: string }>('/ai/llm/default-assistant-slot', { configId, modelId })
  }

  async setFastModel(slot: ModelSlot | null) {
    return put<{ success: boolean; error?: string }>('/ai/llm/fast-model-slot', slot)
  }

  async getProviders(): Promise<LLMProvider[]> {
    return get<LLMProvider[]>('/ai/llm/providers')
  }

  async getProviderRegistry(): Promise<ProviderRegistryItem[]> {
    return get<ProviderRegistryItem[]>('/ai/llm/provider-registry')
  }

  async getModelCatalog(): Promise<ModelCatalogItem[]> {
    return get<ModelCatalogItem[]>('/ai/llm/model-catalog')
  }

  async addConfig(config: AIServiceConfigInput) {
    return post<{ success: boolean; config?: AIServiceConfigDisplay; error?: string }>('/ai/llm/configs', config)
  }

  async updateConfig(id: string, updates: Partial<AIServiceConfigInput>) {
    return put<{ success: boolean; error?: string }>(`/ai/llm/configs/${id}`, updates)
  }

  async deleteConfig(id: string) {
    return del<{ success: boolean; error?: string }>(`/ai/llm/configs/${id}`)
  }

  async validateApiKey(
    provider: string,
    apiKey: string,
    baseUrl?: string,
    model?: string,
    apiFormat?: string,
    configId?: string
  ) {
    return post<{ success: boolean; error?: string }>('/ai/llm/validate-key', {
      provider,
      apiKey,
      baseUrl,
      model,
      apiFormat,
      configId,
    })
  }

  async fetchRemoteModels(provider: string, apiKey: string, baseUrl?: string, apiFormat?: string, configId?: string) {
    return post<{
      success: boolean
      models?: Array<{ id: string; name: string; ownedBy?: string; contextWindow?: number }>
      error?: string
    }>('/ai/llm/remote-models', { provider, apiKey, baseUrl, apiFormat, configId })
  }

  async addCustomProvider(input: CustomProviderInput) {
    return post<ProviderRegistryItem>('/ai/llm/custom-providers', input)
  }

  async updateCustomProvider(id: string, updates: Partial<CustomProviderInput>) {
    return put<{ success: boolean; error?: string }>(`/ai/llm/custom-providers/${id}`, updates)
  }

  async deleteCustomProvider(id: string) {
    return del<{ success: boolean; error?: string }>(`/ai/llm/custom-providers/${id}`)
  }

  async addCustomModel(input: CustomModelInput) {
    return post<{ success: boolean; model?: ModelCatalogItem; error?: string }>('/ai/llm/custom-models', input)
  }

  async updateCustomModel(providerId: string, modelId: string, updates: Partial<CustomModelInput>) {
    return put<{ success: boolean; error?: string }>(
      `/ai/llm/custom-models/${providerId}/${encodeURIComponent(modelId)}`,
      updates
    )
  }

  async deleteCustomModel(providerId: string, modelId: string) {
    return del<{ success: boolean; error?: string }>(
      `/ai/llm/custom-models/${providerId}/${encodeURIComponent(modelId)}`
    )
  }
}
