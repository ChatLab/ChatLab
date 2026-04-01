/**
 * 会话模块类型定义
 */

/** 默认会话切分阈值：30分钟（秒） */
export const DEFAULT_SESSION_GAP_THRESHOLD = 1800

/**
 * 会话列表项类型
 */
export interface ChatSessionItem {
  id: number
  startTs: number
  endTs: number
  messageCount: number
  firstMessageId: number
  /** 会话摘要（如果有） */
  summary?: string | null
}

/**
 * 会话搜索结果项类型（用于 AI 工具）
 */
export interface SessionSearchResultItem {
  id: number
  startTs: number
  endTs: number
  messageCount: number
  /** 是否为完整会话（消息数 <= 预览条数） */
  isComplete: boolean
  /** 预览消息列表 */
  previewMessages: Array<{
    id: number
    senderName: string
    content: string | null
    timestamp: number
  }>
}

/**
 * 会话消息结果类型（用于 AI 工具）
 */
export interface SessionMessagesResult {
  sessionId: number
  startTs: number
  endTs: number
  messageCount: number
  returnedCount: number
  /** 参与者列表 */
  participants: string[]
  /** 消息列表 */
  messages: Array<{
    id: number
    senderName: string
    content: string | null
    timestamp: number
  }>
}

/**
 * 自定义筛选消息类型（完整信息，兼容 MessageList 组件）
 */
export interface FilterMessage {
  id: number
  senderName: string
  senderPlatformId: string
  senderAliases: string[]
  senderAvatar: string | null
  content: string
  timestamp: number
  type: number
  replyToMessageId: string | null
  replyToContent: string | null
  replyToSenderName: string | null
  /** 是否为命中的消息（关键词匹配） */
  isHit: boolean
}

/**
 * 上下文块类型（用于自定义筛选）
 */
export interface ContextBlock {
  /** 块的时间范围 */
  startTs: number
  endTs: number
  /** 消息列表 */
  messages: FilterMessage[]
  /** 命中的消息数量 */
  hitCount: number
}

/**
 * 筛选结果类型
 */
export interface FilterResult {
  /** 上下文块列表 */
  blocks: ContextBlock[]
  /** 统计信息 */
  stats: {
    /** 总消息数 */
    totalMessages: number
    /** 命中的消息数 */
    hitMessages: number
    /** 总字符数 */
    totalChars: number
  }
}

/**
 * 分页信息类型
 */
export interface PaginationInfo {
  /** 当前页码（从 1 开始） */
  page: number
  /** 每页块数 */
  pageSize: number
  /** 总块数 */
  totalBlocks: number
  /** 总命中数 */
  totalHits: number
  /** 是否还有更多 */
  hasMore: boolean
}

/**
 * 带分页的筛选结果类型
 */
export interface FilterResultWithPagination extends FilterResult {
  pagination: PaginationInfo
}

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
  chatSessionIds?: number[]
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
