/**
 * 工具系统类型定义
 *
 * 平台无关的工具注册表类型，同时服务于 MCP Server、HTTP API 和 Electron Agent。
 */

import type { ChartPayload, DatabaseAdapter } from '@openchatlab/core'

// ==================== Schema ====================

/**
 * JSON Schema 参数定义（兼容 MCP tool input schema）
 */
export interface JsonSchema {
  type: 'object'
  properties: Record<
    string,
    {
      type: string
      description?: string
      items?: { type: string }
      properties?: Record<string, unknown>
      additionalProperties?: boolean | Record<string, unknown>
      default?: unknown
      enum?: unknown[]
      minimum?: number
      maximum?: number
    }
  >
  required?: string[]
}

// ==================== Time Filter ====================

export interface TimeFilter {
  startTs: number
  endTs: number
}

// ==================== Data Provider ====================

export interface SearchMessagesResult {
  messages: RawMessage[]
  total: number
}

export interface MemberStatItem {
  name: string
  messageCount: number
  percentage: number
}

export interface SchemaTableInfo {
  name: string
  sql: string
}

export interface ChatOverviewResult {
  name: string
  platform: string
  type: string
  totalMessages: number
  totalMembers: number
  firstMessageTs: number | null
  lastMessageTs: number | null
  topMembers: Array<{ id: number; name: string; count: number }>
}

export interface MemberInfo {
  id: number
  platformId: string
  accountName: string | null
  groupNickname: string | null
  aliases: string[]
  messageCount: number
}

export interface NameHistoryItem {
  nameType: string
  name: string
  startTs: number
  endTs: number | null
}

export interface SegmentSearchResult {
  id: number
  startTs: number
  endTs: number
  messageCount: number
  isComplete: boolean
  previewMessages: Array<{
    id: number
    senderName: string
    content: string | null
    timestamp: number
  }>
}

export interface SegmentMessagesResult {
  segmentId: number
  startTs: number
  endTs: number
  messageCount: number
  returnedCount: number
  participants: string[]
  messages: Array<{
    id: number
    senderName: string
    content: string | null
    timestamp: number
  }>
}

export interface ConversationResult {
  messages: RawMessage[]
  total: number
  member1Name: string
  member2Name: string
}

export interface SegmentSummaryItem {
  id: number
  startTs: number
  endTs: number
  messageCount: number
  participants: string[]
  summary: string | null
}

/**
 * 声明式 SQL 工具执行配置
 */
export interface SqlToolExecution {
  type: 'sqlite'
  query: string
  rowTemplate: string
  summaryTemplate?: string
  fallback: string
}

/**
 * 声明式 SQL 工具定义
 */
export interface SqlToolDef {
  name: string
  description: string
  parameters: JsonSchema
  execution: SqlToolExecution
}

/**
 * 工具数据查询抽象接口
 *
 * Server 和 Electron 各自实现：
 * - CoreDataProvider: 通过 @openchatlab/core 查询函数 + DatabaseAdapter
 * - WorkerDataProvider: 通过 workerManager IPC 调用 Worker 线程
 */
export interface ToolDataProvider {
  // === 基础查询 ===
  searchMessages(
    keywords: string[],
    options?: { timeFilter?: TimeFilter; limit?: number; senderId?: number }
  ): Promise<SearchMessagesResult>

  deepSearchMessages(
    keywords: string[],
    options?: { timeFilter?: TimeFilter; limit?: number; senderId?: number }
  ): Promise<SearchMessagesResult>

  getSearchMessageContext(messageIds: number[], contextBefore: number, contextAfter: number): Promise<RawMessage[]>

  getRecentMessages(options?: { timeFilter?: TimeFilter; limit?: number }): Promise<SearchMessagesResult>

  getMessageContext(messageIds: number[], contextSize: number): Promise<RawMessage[]>

  // === 聊天概览 ===
  getChatOverview(topN?: number): Promise<ChatOverviewResult | null>

  // === 成员相关 ===
  getMembers(): Promise<MemberInfo[]>

  getMemberStats(options?: { timeFilter?: TimeFilter; top?: number }): Promise<MemberStatItem[]>

  getMemberNameHistory(memberId: number): Promise<NameHistoryItem[]>

  // === 时间统计 ===
  getTimeStats(type: 'hourly' | 'weekday' | 'daily', options?: { timeFilter?: TimeFilter }): Promise<unknown[]>

  // === 段落相关 ===
  searchSegments(
    keywords?: string[],
    timeFilter?: TimeFilter,
    limit?: number,
    previewCount?: number
  ): Promise<SegmentSearchResult[]>

  getSegmentMessages(segmentId: number, limit?: number): Promise<SegmentMessagesResult | null>

  getSegmentSummaries(options?: { limit?: number; timeFilter?: TimeFilter }): Promise<SegmentSummaryItem[]>

  // === 对话查询 ===
  getConversationBetween(
    memberId1: number,
    memberId2: number,
    timeFilter?: TimeFilter,
    limit?: number
  ): Promise<ConversationResult>

  // === SQL ===
  executeSql(sql: string): Promise<unknown>

  executeParameterizedSql<T = Record<string, unknown>>(query: string, params: Record<string, unknown>): Promise<T[]>

  getSchema(): Promise<SchemaTableInfo[]>
}

// ==================== Tool Context ====================

/**
 * NLP 分词结果
 */
export interface SegmentResult {
  words: Map<string, number>
  uniqueWords: number
  totalWords: number
}

/**
 * 工具执行上下文
 */
export interface ToolExecutionContext {
  sessionId: string
  locale?: string
  timeFilter?: TimeFilter
  abortSignal?: AbortSignal
  /** 抽象查询接口 */
  dataProvider?: ToolDataProvider
  /** @deprecated 逐步迁移到 dataProvider 后移除；Electron 端不提供此字段 */
  db?: DatabaseAdapter
  /** 搜索结果上下文：向前取多少条 */
  searchContextBefore?: number
  /** 搜索结果上下文：向后取多少条 */
  searchContextAfter?: number
  /** 消息条数上限 */
  maxMessagesLimit?: number
  /** NLP 分词回调（由平台注入 batchSegmentWithFrequency 实现） */
  segmentText?: (texts: string[], locale: string, options: Record<string, unknown>) => SegmentResult
  /** i18n 模板翻译回调（用于 SQL 工具模板国际化） */
  translateTemplate?: (key: string) => string | undefined
}

// ==================== Raw Message ====================

/**
 * 可预处理的原始消息（与 @openchatlab/node-runtime PreprocessableMessage 兼容）
 */
export interface RawMessage {
  id?: number
  senderId?: number
  senderName: string
  senderPlatformId?: string
  content: string | null
  timestamp: number
}

// ==================== Tool Result ====================

/**
 * 工具执行结果
 */
export interface ToolResult {
  content: string
  data?: unknown
  chart?: ChartPayload
  charts?: ChartPayload[]
  /** 消息类工具可透传原始消息数据，供预处理管道消费 */
  rawMessages?: RawMessage[]
}

// ==================== Tool Definition ====================

export type ToolCategory = 'core' | 'analysis'
export type TruncationStrategy = 'keep_first' | 'keep_last'

/**
 * 平台无关的工具定义
 *
 * handler 支持同步和异步返回，兼容 Server（同步 DB）和 Electron（异步 Worker）。
 */
export interface ToolDefinition {
  name: string
  description: string
  inputSchema: JsonSchema
  handler: (params: Record<string, unknown>, context: ToolExecutionContext) => ToolResult | Promise<ToolResult>
  category?: ToolCategory
  truncationStrategy?: TruncationStrategy
}
