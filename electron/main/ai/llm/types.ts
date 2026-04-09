/**
 * LLM 服务类型定义
 * 新类型系统基于 model-types.ts，此文件保留兼容别名
 */

// 重新导出新类型系统
export * from './model-types'

// ==================== 兼容别名 ====================

/**
 * @deprecated 使用 ProviderDefinition.id (string) 代替
 */
export type LLMProvider = string

/**
 * @deprecated 使用 ProviderDefinition 代替
 */
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

// ==================== 旧配置类型（兼容期保留） ====================

/**
 * @deprecated 使用 LLMConnectionConfigCompat 代替
 */
export interface AIServiceConfig {
  id: string
  name: string
  provider: LLMProvider
  apiKey: string
  model?: string
  baseUrl?: string
  maxTokens?: number
  disableThinking?: boolean
  isReasoningModel?: boolean
  customModels?: Array<{ id: string; name: string }>
  createdAt: number
  updatedAt: number
}

/**
 * @deprecated 使用 LLMConnectionStore 代替
 */
export interface AIConfigStore {
  configs: AIServiceConfig[]
  activeConfigId: string | null
}

export const MAX_CONFIG_COUNT = 99
