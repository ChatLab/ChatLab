/**
 * Embedding 服务管理器
 * 支持多配置模式
 */

import type { IEmbeddingService, EmbeddingConfig, EmbeddingServiceConfig } from './types'
import { OpenAICompatibleEmbeddingService } from './openai-compatible'
import { getActiveEmbeddingConfig, isEmbeddingEnabled } from '../config'
import { aiLogger as logger } from '../../logger'
import * as llm from '../../llm'

// 当前活动的 Embedding 服务实例
let activeService: IEmbeddingService | null = null
let activeConfigId: string | null = null

/**
 * 获取 Embedding 服务
 */
export async function getEmbeddingService(): Promise<IEmbeddingService | null> {
  // 检查是否启用
  if (!isEmbeddingEnabled()) {
    return null
  }

  // 获取激活的配置
  const config = getActiveEmbeddingConfig()
  if (!config) {
    return null
  }

  // 如果配置没变，复用现有服务
  if (activeService && activeConfigId === config.id) {
    return activeService
  }

  // 配置变了，重新创建服务
  if (activeService) {
    await activeService.dispose()
    activeService = null
  }

  try {
    activeService = await createEmbeddingService(config)
    activeConfigId = config.id
    return activeService
  } catch (error) {
    logger.error('RAG', 'Failed to create Embedding service', error)
    return null
  }
}

/**
 * 创建 Embedding 服务实例
 */
async function createEmbeddingService(config: EmbeddingServiceConfig): Promise<IEmbeddingService> {
  const apiConfig = resolveApiConfig(config)
  logger.info('RAG', `Using Embedding: ${config.name} (${apiConfig.model})`)

  return new OpenAICompatibleEmbeddingService(apiConfig)
}

/**
 * 解析 API 配置
 */
function resolveApiConfig(config: EmbeddingServiceConfig): {
  baseUrl: string
  apiKey?: string
  model: string
} {
  if (config.apiSource === 'reuse_llm') {
    // 复用当前 LLM 配置
    const llmConfig = llm.getActiveConfig()

    if (!llmConfig) {
      throw new Error('未找到激活的 LLM 配置，请先在「模型配置」中添加 AI 服务')
    }

    // 使用 LLM 的 baseUrl（如果有）
    const baseUrl = llmConfig.baseUrl || getDefaultBaseUrl(llmConfig.provider)

    return {
      baseUrl,
      apiKey: llmConfig.apiKey || undefined,
      model: config.model,
    }
  } else {
    // 独立配置
    if (!config.baseUrl) {
      throw new Error('自定义 API 模式需要配置端点地址')
    }

    return {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
    }
  }
}

/**
 * 获取提供商的默认 baseUrl
 */
function getDefaultBaseUrl(provider: string): string {
  const defaultUrls: Record<string, string> = {
    deepseek: 'https://api.deepseek.com/v1',
    qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    openai: 'https://api.openai.com/v1',
    'openai-compatible': 'http://localhost:11434/v1', // Ollama 默认
  }

  return defaultUrls[provider] || 'http://localhost:11434/v1'
}

/**
 * 重置 Embedding 服务
 * 配置变更后调用
 */
export async function resetEmbeddingService(): Promise<void> {
  if (activeService) {
    await activeService.dispose()
    activeService = null
    activeConfigId = null
    logger.info('RAG', 'Embedding service reset')
  }
}

/**
 * 验证 Embedding 服务配置
 */
export async function validateEmbeddingConfig(
  config: EmbeddingConfig | EmbeddingServiceConfig
): Promise<{ success: boolean; error?: string }> {
  try {
    // 转换为 EmbeddingServiceConfig 格式
    const serviceConfig: EmbeddingServiceConfig =
      'id' in config
        ? config
        : {
            id: 'temp',
            name: 'temp',
            apiSource: config.apiSource || 'reuse_llm',
            model: config.model || 'nomic-embed-text',
            baseUrl: config.baseUrl,
            apiKey: config.apiKey,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }

    const service = await createEmbeddingService(serviceConfig)
    const result = await service.validate()
    await service.dispose()
    return result
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// 重导出类型
export type { IEmbeddingService, EmbeddingConfig, EmbeddingServiceConfig }
