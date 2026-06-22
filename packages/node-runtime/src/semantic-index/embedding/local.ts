/**
 * 本地 ONNX embedding provider（@huggingface/transformers）
 *
 * 关键约束（P0-3）：Qwen3 必须 batch=1，batch 会污染 last_token embedding；本地 CPU
 * 上 batch 也无吞吐收益。profile.maxBatchSize 控制单次推理的最大文本数。
 *
 * pipeline 工厂可注入，单元测试用 fake 工厂验证 batch 切分与 query instruction，不下载模型；
 * 真实模型加载在 env-gated smoke 测试中验证。
 */

import type { EmbeddingProvider } from './types'
import type { LocalEmbeddingProfile } from './profiles'
import { applyQueryInstruction, clampTextChars } from './text'

/** 一次特征抽取调用：输入文本数组，返回每条文本的向量（number[][]） */
export type FeatureExtractFn = (
  texts: string[],
  options: { pooling: LocalEmbeddingProfile['pooling']; normalize: boolean }
) => Promise<number[][]>

/** pipeline 工厂：按 modelId/dtype/cacheDir 构造特征抽取器 */
export type LocalPipelineFactory = (params: {
  modelId: string
  dtype?: 'fp32' | 'q8'
  cacheDir?: string
}) => Promise<FeatureExtractFn>

const defaultPipelineFactory: LocalPipelineFactory = async ({ modelId, dtype, cacheDir }) => {
  const transformers = await import('@huggingface/transformers')
  if (cacheDir) {
    transformers.env.cacheDir = cacheDir
    transformers.env.allowRemoteModels = true
  }
  const extractor = await transformers.pipeline('feature-extraction', modelId, dtype ? { dtype } : undefined)
  return async (texts, options) => {
    const out = await extractor(texts, { pooling: options.pooling, normalize: options.normalize })
    return out.tolist() as number[][]
  }
}

export interface LocalEmbeddingProviderOptions {
  cacheDir?: string
  pipelineFactory?: LocalPipelineFactory
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly modelId: string
  readonly dim: number
  readonly maxTokens: number
  readonly documentBatchSize: number

  private profile: LocalEmbeddingProfile
  private options: LocalEmbeddingProviderOptions
  private extractorPromise: Promise<FeatureExtractFn> | null = null

  constructor(profile: LocalEmbeddingProfile, options: LocalEmbeddingProviderOptions = {}) {
    this.profile = profile
    this.options = options
    this.modelId = profile.modelId
    this.dim = profile.dim
    this.maxTokens = profile.maxTokens
    this.documentBatchSize = profile.maxBatchSize ?? 1
  }

  private getExtractor(): Promise<FeatureExtractFn> {
    if (!this.extractorPromise) {
      const factory = this.options.pipelineFactory ?? defaultPipelineFactory
      this.extractorPromise = factory({
        modelId: this.profile.modelId,
        dtype: this.profile.dtype,
        cacheDir: this.options.cacheDir,
      })
    }
    return this.extractorPromise
  }

  private toFloat32(vector: number[]): Float32Array {
    if (vector.length !== this.profile.dim) {
      throw new Error(`model ${this.profile.modelId} returned dim ${vector.length}, expected ${this.profile.dim}`)
    }
    return Float32Array.from(vector)
  }

  async embedDocuments(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return []
    const extractor = await this.getExtractor()
    const batchSize = this.profile.maxBatchSize ?? texts.length
    const clamped = texts.map((t) => clampTextChars(t, this.profile.maxTextChars))

    const result: Float32Array[] = []
    for (let i = 0; i < clamped.length; i += batchSize) {
      const batch = clamped.slice(i, i + batchSize)
      const vectors = await extractor(batch, { pooling: this.profile.pooling, normalize: this.profile.normalize })
      for (const v of vectors) result.push(this.toFloat32(v))
    }
    return result
  }

  async embedQuery(text: string): Promise<Float32Array> {
    const withInstruction = applyQueryInstruction(this.profile.queryInstruction, text)
    const [vector] = await this.embedDocuments([withInstruction])
    return vector
  }
}
