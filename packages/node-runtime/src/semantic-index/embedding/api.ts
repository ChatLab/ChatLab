/**
 * OpenAI-compatible embedding API provider
 *
 * Phase 1 只承诺 OpenAI-compatible /embeddings 调用路径，配置仅 baseUrl/apiKey/model，
 * 不暴露 dimensions（只记录 provider 实际返回维度）。API 模式 query 与 document 一致，
 * 不加本地模型的 queryInstruction。
 *
 * fetch 可注入，单元测试验证请求结构与响应解析，不联网。
 */

import type { EmbeddingProvider } from './types'

/** API embedding 默认一次提交 8 个 chunk，兼容更多 OpenAI-compatible 服务的批量上限。 */
export const API_DOCUMENT_BATCH_SIZE = 8

export interface OpenAICompatibleConfig {
  baseUrl: string
  apiKey: string
  model: string
  /** 单文本 token 上限提示，默认 8192 */
  maxTokens?: number
}

interface EmbeddingResponse {
  data: Array<{ index: number; embedding: number[] }>
}

export type FetchFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>

const defaultFetchFn: FetchFn = (url, init) => fetch(url, init) as unknown as ReturnType<FetchFn>

function buildEmbeddingsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  return trimmed.endsWith('/embeddings') ? trimmed : `${trimmed}/embeddings`
}

export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly modelId: string
  readonly maxTokens: number
  readonly documentBatchSize = API_DOCUMENT_BATCH_SIZE

  private config: OpenAICompatibleConfig
  private fetchFn: FetchFn
  private url: string
  private knownDim = 0

  constructor(config: OpenAICompatibleConfig, options: { fetchFn?: FetchFn } = {}) {
    this.config = config
    this.fetchFn = options.fetchFn ?? defaultFetchFn
    this.modelId = config.model
    this.maxTokens = config.maxTokens ?? 8192
    this.url = buildEmbeddingsUrl(config.baseUrl)
  }

  /** 实际返回维度；首次成功调用后才确定，调用前为 0 */
  get dim(): number {
    return this.knownDim
  }

  async embedDocuments(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return []
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.config.apiKey.trim()) headers.Authorization = `Bearer ${this.config.apiKey}`

    const response = await this.fetchFn(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: this.config.model, input: texts }),
    })

    if (!response.ok) {
      await response.text().catch(() => '') // consume body to avoid connection leak
      throw new Error(`Embedding API request failed: ${response.status}`)
    }

    const payload = (await response.json()) as EmbeddingResponse
    const sorted = [...payload.data].sort((a, b) => a.index - b.index)
    const vectors = sorted.map((item) => Float32Array.from(item.embedding))
    if (vectors.length > 0) this.knownDim = vectors[0].length
    return vectors
  }

  async embedQuery(text: string): Promise<Float32Array> {
    const [vector] = await this.embedDocuments([text])
    return vector
  }

  async preload(): Promise<void> {
    // API mode: no local model to download
  }
}
