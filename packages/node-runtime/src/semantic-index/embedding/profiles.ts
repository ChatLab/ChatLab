/**
 * 本地 embedding 模型 profile（静态定义，单一事实来源）
 *
 * 取值依据 chunking-decision-final.md 第 6.2/6.3 节与 P0-2/P0-3 验证结论。
 * 这些 profile 决定 chunk 的 dim/pooling/normalize，变化会触发索引重建。
 */

import type { EmbeddingPooling } from './types'

export interface LocalEmbeddingProfile {
  /** 用户展示名 */
  displayName: string
  /** transformers.js 下载源 modelId */
  modelId: string
  architecture: 'bert' | 'qwen3'
  dim: number
  /** 单文本 token 上限（ChatLab profile cap，非模型真实上限） */
  maxTokens: number
  /** 单文本字符上限（可选护栏） */
  maxTextChars?: number
  pooling: EmbeddingPooling
  normalize: boolean
  /** transformers.js dtype；BGE 默认 fp32，Qwen3 用 q8 */
  dtype?: 'fp32' | 'q8'
  /** 固定 batch 上限；Qwen3 必须为 1（P0-3：batch 污染 last_token） */
  maxBatchSize?: number
  /** query 前缀指令；document 不加 */
  queryInstruction: string
  /** 近似下载体积（MB），用于 UI 提示 */
  approxDownloadMB: number
}

/** BGE small zh：中文轻量入口（P0-2） */
export const BGE_PROFILE: LocalEmbeddingProfile = {
  displayName: 'BGE small zh',
  modelId: 'Xenova/bge-small-zh-v1.5',
  architecture: 'bert',
  dim: 512,
  maxTokens: 512,
  pooling: 'cls',
  normalize: true,
  dtype: 'fp32',
  queryInstruction: '为这个句子生成表示以用于检索相关文章：',
  approxDownloadMB: 97,
}

/** Qwen3-Embedding-0.6B：通用本地推荐模型，必须 batch=1（P0-3） */
export const QWEN3_PROFILE: LocalEmbeddingProfile = {
  displayName: 'Qwen3 Embedding 0.6B',
  modelId: 'onnx-community/Qwen3-Embedding-0.6B-ONNX',
  architecture: 'qwen3',
  dim: 1024,
  maxTokens: 8192,
  maxTextChars: 2400,
  pooling: 'last_token',
  normalize: true,
  dtype: 'q8',
  maxBatchSize: 1,
  queryInstruction: 'Given a chat history search query, retrieve relevant conversation messages that answer the query',
  approxDownloadMB: 593,
}

const ALL_LOCAL_PROFILES: LocalEmbeddingProfile[] = [BGE_PROFILE, QWEN3_PROFILE]

/**
 * 按 UI 语言返回可选本地模型列表。
 * 中文 UI 同时提供 BGE（轻量快）与 Qwen3（通用慢）；其他语言只提供 Qwen3。
 */
export function getLocalProfilesForLocale(locale: string): LocalEmbeddingProfile[] {
  if (locale.startsWith('zh')) return [BGE_PROFILE, QWEN3_PROFILE]
  return [QWEN3_PROFILE]
}

export function getLocalProfileByModelId(modelId: string): LocalEmbeddingProfile | null {
  return ALL_LOCAL_PROFILES.find((p) => p.modelId === modelId) ?? null
}
