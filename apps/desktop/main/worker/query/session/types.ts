/**
 * Session module type definitions.
 * Core types (ChatSessionItem, DEFAULT_SESSION_GAP_THRESHOLD) are re-exported
 * from @openchatlab/core; Electron-only types remain here.
 */

export { DEFAULT_SESSION_GAP_THRESHOLD } from '@openchatlab/core'
export type { ChatSessionItem, SessionIndexStats } from '@openchatlab/core'

// AI tool types — re-exported from core via aiTools.ts
export type { SessionSearchResultItem, SessionMessagesResult } from './aiTools'

// Filter types — re-exported from @openchatlab/core
export type {
  FilterMessage,
  ContextBlock,
  FilterStats,
  PaginationInfo,
  FilterResultWithPagination,
} from '@openchatlab/core'

/**
 * 导出筛选结果参数
 */
export interface ExportFilterParams {
  sessionId: string
  sessionName: string
  outputDir: string
  filterMode: 'condition' | 'session'
  // 条件筛选参数
  keywords?: string[]
  timeFilter?: { startTs: number; endTs: number }
  senderIds?: number[]
  contextSize?: number
  // 会话筛选参数
  segmentIds?: number[]
}

/**
 * 导出进度类型
 */
export interface ExportProgress {
  /** 阶段 */
  stage: 'preparing' | 'exporting' | 'done' | 'error'
  /** 当前处理的块索引（从 1 开始） */
  currentBlock: number
  /** 总块数 */
  totalBlocks: number
  /** 百分比（0-100） */
  percentage: number
  /** 状态消息 */
  message: string
}
