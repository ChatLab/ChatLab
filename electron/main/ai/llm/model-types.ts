/**
 * 模型系统核心类型定义
 * 基于 Provider Registry + Model Catalog 分层架构
 */

// ==================== Provider 定义 ====================

export type ProviderKind = 'official' | 'aggregator' | 'openai-compatible'

export interface ProviderDefinition {
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

// ==================== Model 定义 ====================

export type ModelCapability = 'chat' | 'reasoning' | 'vision' | 'function_calling' | 'embedding' | 'ranking'

export type ModelStatus = 'stable' | 'preview' | 'deprecated'

export type ModelRecommendedFor = 'chat' | 'embedding' | 'rerank'

export interface ModelDefinition {
  id: string
  providerId: string
  name: string
  description?: string
  capabilities: ModelCapability[]
  recommendedFor: ModelRecommendedFor[]
  status: ModelStatus
  builtin: boolean
  editable: boolean
}

// ==================== 连接配置 ====================

export interface LLMConnectionConfig {
  id: string
  name: string
  providerId: string
  modelId: string
  apiKey: string
  baseUrl?: string
  maxTokens?: number
  createdAt: number
  updatedAt: number
}

export interface LLMConnectionConfigCompat extends LLMConnectionConfig {
  disableThinking?: boolean
  isReasoningModel?: boolean
  customModels?: Array<{ id: string; name: string }>
}

// ==================== 用途选择（预留） ====================

export type ModelUsage = 'chat' | 'embedding'

export interface ModelSelectionState {
  usage: ModelUsage
  configId: string
  providerId: string
  modelId: string
}

// ==================== 存储结构 ====================

export interface ProviderRegistryStore {
  providers: ProviderDefinition[]
}

export interface ModelCatalogStore {
  models: ModelDefinition[]
}

export interface LLMConnectionStore {
  configs: LLMConnectionConfigCompat[]
  activeConfigId: string | null
  schemaVersion: number
}
