/**
 * 语义索引前端服务类型
 *
 * 与 packages/node-runtime 的共享 Web 路由契约保持一致。
 * 语义索引在 Electron 与 CLI Web 均走 HTTP（无平台专属 IPC）。
 */

export type SemanticIndexMode = 'local' | 'api'

export interface SemanticIndexApiConfig {
  baseUrl: string
  model: string
  authProfile?: string
  dim?: number
}

export interface SemanticIndexConfig {
  version: number
  /** 全局功能开关：关闭后不暴露 AI 检索工具、不建立/检索索引（已有索引数据保留） */
  enabled: boolean
  mode: SemanticIndexMode
  local: { modelId: string }
  api: SemanticIndexApiConfig | null
  /** AI 单次语义检索默认返回片段数（范围 5-15，默认 10） */
  searchMaxResults: number
}

/** 单次检索默认片段数范围 */
export const SEARCH_MAX_RESULTS_MIN = 5
export const SEARCH_MAX_RESULTS_MAX = 15
export const SEARCH_MAX_RESULTS_DEFAULT = 10

export type SemanticIndexStatusValue = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

export interface SemanticIndexSessionStatus {
  sessionId: string
  enabled: boolean
  indexStatus: SemanticIndexStatusValue
  needsRebuild: boolean
  /** completed session has received new messages since last index run */
  hasNewMessages?: boolean
  totalMessages: number
  indexedMessages: number
  chunkCount: number
  coverage: number
  queued: boolean
  running: boolean
  partial: boolean
  error: string | null
  modelId: string | null
}
