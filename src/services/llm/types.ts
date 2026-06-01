export interface AIServiceConfigDisplay {
  id: string
  name: string
  provider: string
  apiKeySet: boolean
  model?: string
  baseUrl?: string
  maxTokens?: number
  apiFormat?: string
  customModels?: Array<{ id: string; name: string }>
  createdAt: number
  updatedAt: number
}

export interface ModelSlot {
  configId: string
  modelId: string
}

export interface LLMConfigStore {
  configs: AIServiceConfigDisplay[]
  defaultAssistant: ModelSlot | null
  fastModel: ModelSlot | null
}

export interface LLMProvider {
  id: string
  name: string
  defaultBaseUrl: string
  models: Array<{ id: string; name: string; description?: string }>
}

export type ProviderKind = 'official' | 'aggregator' | 'openai-compatible'

export interface ProviderRegistryItem {
  id: string
  name: string
  kind: ProviderKind
  website?: string
  consoleUrl?: string
  defaultBaseUrl: string
  authMode: 'api-key'
  supportsCustomModels: boolean
  builtin: boolean
  enabledByDefault: boolean
  modelIds: string[]
}

export type ModelCapability = 'chat' | 'reasoning' | 'vision' | 'function_calling' | 'embedding' | 'ranking'
export type ModelStatus = 'stable' | 'preview' | 'deprecated'
export type ModelRecommendedFor = 'chat' | 'embedding' | 'rerank'

export interface ModelCatalogItem {
  id: string
  providerId: string
  name: string
  description?: string
  contextWindow?: number
  capabilities: ModelCapability[]
  recommendedFor: ModelRecommendedFor[]
  status: ModelStatus
  builtin: boolean
  editable: boolean
}

export interface CustomProviderInput {
  name: string
  kind?: string
  defaultBaseUrl: string
  supportsCustomModels?: boolean
  modelIds?: string[]
  website?: string
  consoleUrl?: string
}

export interface CustomModelInput {
  id: string
  providerId: string
  name: string
  description?: string
  contextWindow?: number
  capabilities?: string[]
  recommendedFor?: string[]
  status?: string
}

export interface AIServiceConfigInput {
  name: string
  provider: string
  apiKey: string
  model?: string
  baseUrl?: string
  maxTokens?: number
  apiFormat?: string
  customModels?: Array<{ id: string; name: string }>
}

export interface LLMServiceAdapter {
  hasConfig(): Promise<boolean>
  getAllConfigs(): Promise<AIServiceConfigDisplay[]>
  getConfigStore(): Promise<LLMConfigStore>
  getDefaultAssistantSlot(): Promise<ModelSlot | null>
  getFastModelSlot(): Promise<ModelSlot | null>
  setDefaultAssistantModel(configId: string, modelId: string): Promise<{ success: boolean; error?: string }>
  setFastModel(slot: ModelSlot | null): Promise<{ success: boolean; error?: string }>
  getProviders(): Promise<LLMProvider[]>
  getProviderRegistry(): Promise<ProviderRegistryItem[]>
  getModelCatalog(): Promise<ModelCatalogItem[]>
  addConfig(
    config: AIServiceConfigInput
  ): Promise<{ success: boolean; config?: AIServiceConfigDisplay; error?: string }>
  updateConfig(id: string, updates: Partial<AIServiceConfigInput>): Promise<{ success: boolean; error?: string }>
  deleteConfig(id: string): Promise<{ success: boolean; error?: string }>
  validateApiKey(
    provider: string,
    apiKey: string,
    baseUrl?: string,
    model?: string,
    apiFormat?: string,
    configId?: string
  ): Promise<{ success: boolean; error?: string }>
  fetchRemoteModels(
    provider: string,
    apiKey: string,
    baseUrl?: string,
    apiFormat?: string,
    configId?: string
  ): Promise<{
    success: boolean
    models?: Array<{ id: string; name: string; ownedBy?: string; contextWindow?: number }>
    error?: string
  }>
  addCustomProvider(input: CustomProviderInput): Promise<ProviderRegistryItem>
  updateCustomProvider(id: string, updates: Partial<CustomProviderInput>): Promise<{ success: boolean; error?: string }>
  deleteCustomProvider(id: string): Promise<{ success: boolean; error?: string }>
  addCustomModel(input: CustomModelInput): Promise<{ success: boolean; model?: ModelCatalogItem; error?: string }>
  updateCustomModel(
    providerId: string,
    modelId: string,
    updates: Partial<CustomModelInput>
  ): Promise<{ success: boolean; error?: string }>
  deleteCustomModel(providerId: string, modelId: string): Promise<{ success: boolean; error?: string }>
}
