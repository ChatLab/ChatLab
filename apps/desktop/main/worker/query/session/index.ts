/**
 * 会话模块统一导出
 * 提供会话索引管理、AI 工具查询、自定义筛选和导出等功能
 */

// Types — core types re-exported via ./types, Electron-only types kept there
export type {
  ChatSessionItem,
  SessionIndexStats,
  SessionSearchResultItem,
  SessionMessagesResult,
  FilterMessage,
  ContextBlock,
  FilterStats,
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
  getAllIndexStats,
  updateSessionGapThreshold,
  getSessions,
  getSessionsByTimeRange,
  getRecentChatSessions,
  getSegmentSummariesInWorker,
  saveSessionSummary,
  getSessionSummary,
} from './sessionIndex'

// AI 工具专用查询
export { searchSegments, getSegmentMessages } from './aiTools'

// 自定义筛选
export { filterMessagesWithContext, getMultipleSessionsMessages } from './filter'

// 导出功能
export { exportFilterResultToFile } from './export'
