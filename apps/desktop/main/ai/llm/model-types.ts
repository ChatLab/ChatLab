/**
 * 模型系统核心类型定义 — 从 @openchatlab/core 重导出
 */

import type {
  ProviderDefinition as _ProviderDefinition,
  ModelDefinition as _ModelDefinition,
  ModelSlot as _ModelSlot,
} from '@openchatlab/core'

export type {
  ProviderKind,
  ProviderDefinition,
  ModelCapability,
  ModelStatus,
  ModelRecommendedFor,
  ModelDefinition,
  ModelSlot,
} from '@openchatlab/core'

// Electron 专用扩展类型（不在 core 中）

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
  customModels?: Array<{ id: string; name: string }>
}

export type ModelUsage = 'chat' | 'embedding'

export interface ModelSelectionState {
  usage: ModelUsage
  configId: string
  providerId: string
  modelId: string
}

export interface ProviderRegistryStore {
  providers: _ProviderDefinition[]
}

export interface ModelCatalogStore {
  models: _ModelDefinition[]
}

export interface LLMConnectionStore {
  configs: LLMConnectionConfigCompat[]
  defaultAssistant: _ModelSlot | null
  fastModel: _ModelSlot | null
  schemaVersion: number
}
