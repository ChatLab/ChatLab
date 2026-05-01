/**
 * LLM 服务类型定义
 */

export * from './model-types'

export type LLMProvider = string

export interface ProviderInfo {
  id: string
  name: string
  defaultBaseUrl: string
  models: Array<{
    id: string
    name: string
    description?: string
  }>
}

export interface AIServiceConfig {
  id: string
  name: string
  provider: LLMProvider
  apiKey: string
  model?: string
  baseUrl?: string
  maxTokens?: number
  apiFormat?: string
  disableThinking?: boolean
  isReasoningModel?: boolean
  customModels?: Array<{ id: string; name: string }>
  createdAt: number
  updatedAt: number
}

export interface AIConfigStore {
  configs: AIServiceConfig[]
  defaultAssistant: import('./model-types').ModelSlot | null
  fastModel: import('./model-types').ModelSlot | null
}

export const MAX_CONFIG_COUNT = 99
