/**
 * 语义索引独立配置
 *
 * 存储位置：~/.chatlab/ai/semantic-index-config.json（独立于聊天 LLM 的 provider/model 管理）。
 * API Key 不落本配置，只保存 auth-profiles.json 中的 authProfile 引用。
 *
 * Phase 1 只有一个"当前向量配置"：local 或 OpenAI-compatible。
 *
 * 重建信号：模型身份（resolveModelId）变化即需要重建。
 * - 换本地模型 / API baseUrl / API 模型名 -> 身份变化 -> 已启用对话索引需重建。
 * - 只改 API Key（authProfile 指向内容）-> 身份不变 -> 不重建。
 * chunk 以模型身份作为 model_id 分区，新配置重建完成前自然查不到旧索引。
 */

import fs from 'node:fs'
import path from 'node:path'
import { BGE_PROFILE } from './embedding/profiles'

export type SemanticIndexMode = 'local' | 'api'

export interface SemanticIndexLocalConfig {
  /** 本地模型 profile 的 modelId */
  modelId: string
}

export interface SemanticIndexApiConfig {
  baseUrl: string
  model: string
  /** auth-profiles.json 中的 profile 引用（只存引用，不存 key） */
  authProfile?: string
  /** API 模型维度；未知时运行时由返回向量长度确定 */
  dim?: number
}

export interface SemanticIndexConfig {
  version: number
  mode: SemanticIndexMode
  local: SemanticIndexLocalConfig
  api: SemanticIndexApiConfig | null
  /** AI 单次语义检索默认返回片段数（范围 5-15） */
  searchMaxResults: number
}

/** setConfig 入参：searchMaxResults 可省略（缺省由 normalize 填充默认值） */
export type SemanticIndexConfigInput = Omit<SemanticIndexConfig, 'searchMaxResults'> & { searchMaxResults?: number }

export const SEMANTIC_INDEX_CONFIG_VERSION = 1

/** 单次检索默认片段数与用户可配置范围 */
export const SEARCH_MAX_RESULTS_DEFAULT = 10
export const SEARCH_MAX_RESULTS_MIN = 5
export const SEARCH_MAX_RESULTS_MAX = 15
/** LLM 单次检索片段数硬上限（高于用户可配置范围，仍受证据/token 预算约束） */
export const SEARCH_MAX_RESULTS_HARD_CAP = 20

export function clampSearchMaxResults(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return SEARCH_MAX_RESULTS_DEFAULT
  return Math.max(SEARCH_MAX_RESULTS_MIN, Math.min(SEARCH_MAX_RESULTS_MAX, Math.floor(value)))
}

export function defaultSemanticIndexConfig(): SemanticIndexConfig {
  return {
    version: SEMANTIC_INDEX_CONFIG_VERSION,
    mode: 'local',
    local: { modelId: BGE_PROFILE.modelId },
    api: null,
    searchMaxResults: SEARCH_MAX_RESULTS_DEFAULT,
  }
}

/**
 * 当前配置的模型身份。作为 chunk 的 model_id 分区键与重建信号。
 */
export function resolveModelId(config: SemanticIndexConfig): string {
  if (config.mode === 'api' && config.api) {
    return `api:${config.api.baseUrl}#${config.api.model}`
  }
  return config.local.modelId
}

function normalizeConfig(raw: Partial<SemanticIndexConfig> | null | undefined): SemanticIndexConfig {
  const base = defaultSemanticIndexConfig()
  if (!raw || typeof raw !== 'object') return base
  const mode: SemanticIndexMode = raw.mode === 'api' ? 'api' : 'local'
  const api = raw.api
    ? {
        baseUrl: raw.api.baseUrl ?? '',
        model: raw.api.model ?? '',
        authProfile: raw.api.authProfile,
        dim: raw.api.dim,
      }
    : null
  return {
    version: SEMANTIC_INDEX_CONFIG_VERSION,
    mode,
    local: { modelId: raw.local?.modelId || base.local.modelId },
    api,
    searchMaxResults: clampSearchMaxResults(raw.searchMaxResults),
  }
}

export class SemanticIndexConfigStore {
  private filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
  }

  get(): SemanticIndexConfig {
    if (!fs.existsSync(this.filePath)) return defaultSemanticIndexConfig()
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Partial<SemanticIndexConfig>
      return normalizeConfig(raw)
    } catch {
      return defaultSemanticIndexConfig()
    }
  }

  set(config: SemanticIndexConfigInput): SemanticIndexConfig {
    const normalized = normalizeConfig(config)
    const dir = path.dirname(this.filePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(this.filePath, JSON.stringify(normalized, null, 2), 'utf-8')
    return normalized
  }

  resolveModelId(): string {
    return resolveModelId(this.get())
  }
}
