/**
 * OpenAI 兼容的 Embedding 服务
 *
 * 支持调用 OpenAI、Ollama 等兼容 API
 */

import type { IEmbeddingService } from './types'
import { aiLogger as logger } from '../../logger'

/**
 * OpenAI 兼容 API 配置
 */
export interface OpenAICompatibleEmbeddingConfig {
  baseUrl: string
  apiKey?: string
  model: string
}

/**
 * OpenAI 兼容的 Embedding 服务实现
 */
export class OpenAICompatibleEmbeddingService implements IEmbeddingService {
  private baseUrl: string
  private apiKey?: string
  private model: string
  private dimensions: number = 0 // 首次调用时确定

  constructor(config: OpenAICompatibleEmbeddingConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '') // 移除末尾斜杠
    this.apiKey = config.apiKey
    this.model = config.model
  }

  /**
   * 嵌入单条文本
   */
  async embed(text: string): Promise<number[]> {
    const vectors = await this.callEmbeddingApi([text])
    return vectors[0]
  }

  /**
   * 批量嵌入文本
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    return this.callEmbeddingApi(texts)
  }

  /**
   * 调用 Embedding API
   */
  private async callEmbeddingApi(input: string[]): Promise<number[][]> {
    const url = `${this.baseUrl}/embeddings`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          input,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`API 请求失败 (${response.status}): ${errorText}`)
      }

      const data = (await response.json()) as {
        data?: Array<{ embedding: number[]; index: number }>
      }

      if (!data.data || data.data.length === 0) {
        throw new Error('API 返回数据为空')
      }

      // 按 index 排序，确保顺序正确
      const sorted = data.data.sort((a, b) => a.index - b.index)
      const vectors = sorted.map((item) => item.embedding)

      // 记录维度
      if (vectors.length > 0 && this.dimensions === 0) {
        this.dimensions = vectors[0].length
      }

      return vectors
    } catch (error) {
      logger.error('RAG', `Embedding API call failed: ${url}`, error)
      throw error
    }
  }

  /**
   * 获取提供商名称
   */
  getProvider(): string {
    return `OpenAI Compatible (${this.model})`
  }

  /**
   * 获取向量维度
   */
  getDimensions(): number {
    return this.dimensions
  }

  /**
   * 验证服务可用性
   */
  async validate(): Promise<{ success: boolean; error?: string }> {
    try {
      // 测试一次 embedding
      const testVector = await this.embed('test')

      if (testVector.length === 0) {
        return { success: false, error: '返回的向量为空' }
      }

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * 释放资源
   */
  async dispose(): Promise<void> {
    // API 服务无需释放资源
  }
}
