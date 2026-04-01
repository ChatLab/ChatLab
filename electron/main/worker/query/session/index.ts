/**
 * 会话模块统一导出
 * 提供会话索引管理、AI 工具查询、自定义筛选和导出等功能
 */

// 类型定义
export type {
  ChatSessionItem,
  SessionSearchResultItem,
  SessionMessagesResult,
  FilterMessage,
  ContextBlock,
  FilterResult,
  PaginationInfo,
  FilterResultWithPagination,
  ExportFilterParams,
  ExportProgress,
} from './types'

export { DEFAULT_SESSION_GAP_THRESHOLD } from './types'

// 会话索引管理
export {
  generateSessions,
  generateIncrementalSessions,
  clearSessions,
  hasSessionIndex,
  getSessionStats,
  updateSessionGapThreshold,
  getSessions,
  saveSessionSummary,
  getSessionSummary,
} from './sessionIndex'

// AI 工具专用查询
export { searchSessions, getSessionMessages } from './aiTools'

// 自定义筛选
export { filterMessagesWithContext, getMultipleSessionsMessages } from './filter'

// 导出功能
export { exportFilterResultToFile } from './export'
