/**
 * 工具系统类型定义
 *
 * 平台无关的工具注册表类型，同时服务于 MCP Server、HTTP API 和 Electron Agent。
 */

import type { ChartPayload, DatabaseAdapter, EvidenceTimeRangeMs } from '@openchatlab/core'

export type {
  EvidenceRetrievalMode,
  EvidenceStatus,
  EvidencePayloadStatus,
  EvidenceWarning,
  EvidenceTimeRangeMs,
  ChatEvidenceSource,
  ChatEvidenceGroup,
  ChatEvidencePayload,
} from '@openchatlab/core'

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

export interface ToolTimeRange {
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
    options?: { timeFilter?: ToolTimeRange; limit?: number; senderId?: number }
  ): Promise<SearchMessagesResult>

  deepSearchMessages(
    keywords: string[],
    options?: { timeFilter?: ToolTimeRange; limit?: number; senderId?: number }
  ): Promise<SearchMessagesResult>

  getSearchMessageContext(messageIds: number[], contextBefore: number, contextAfter: number): Promise<RawMessage[]>

  getRecentMessages(options?: { timeFilter?: ToolTimeRange; limit?: number }): Promise<SearchMessagesResult>

  getMessageContext(messageIds: number[], contextSize: number): Promise<RawMessage[]>

  // === 聊天概览 ===
  getChatOverview(topN?: number): Promise<ChatOverviewResult | null>

  // === 成员相关 ===
  getMembers(): Promise<MemberInfo[]>

  getMemberStats(options?: { timeFilter?: ToolTimeRange; top?: number }): Promise<MemberStatItem[]>

  getMemberNameHistory(memberId: number): Promise<NameHistoryItem[]>

  // === 时间统计 ===
  getTimeStats(type: 'hourly' | 'weekday' | 'daily', options?: { timeFilter?: ToolTimeRange }): Promise<unknown[]>

  // === 段落相关 ===
  getSegmentMessages(segmentId: number, limit?: number): Promise<SegmentMessagesResult | null>

  getSegmentSummaries(options?: { limit?: number; timeFilter?: ToolTimeRange }): Promise<SegmentSummaryItem[]>

  // === 对话查询 ===
  getConversationBetween(
    memberId1: number,
    memberId2: number,
    timeFilter?: ToolTimeRange,
    limit?: number
  ): Promise<ConversationResult>

  // === SQL ===
  executeSql(sql: string): Promise<unknown>

  executeParameterizedSql<T = Record<string, unknown>>(query: string, params: Record<string, unknown>): Promise<T[]>

  getSchema(): Promise<SchemaTableInfo[]>
}

// ==================== Semantic Search Tool ====================

/** 单次语义检索默认返回片段数（用户可配置范围 5-15） */
export const SEMANTIC_SEARCH_DEFAULT_MAX_RESULTS = 10
/** 单次语义检索片段数硬上限（LLM 不可超过；须与 node-runtime SEARCH_MAX_RESULTS_HARD_CAP 一致） */
export const SEMANTIC_SEARCH_MAX_RESULTS_HARD_CAP = 20

/** 工具返回的安全来源条目（已脱敏，不含原始消息） */
export interface SemanticSearchToolSource {
  startMessageId: number
  endMessageId: number
  score: number
  chunkIds: string[]
  /** 已脱敏的片段预览 */
  snippet: string
  /** 已脱敏的完整证据块文本，用于证据检索分类与引用 */
  text?: string
  /** ISO 时间 */
  startTime?: string
  endTime?: string
}

/** 语义检索工具结果：text 为面向 LLM 的安全证据文本，其余为安全 metadata */
export interface SemanticSearchToolResult {
  available: boolean
  reason?: string
  /** 已清洗/脱敏/匿名化/截断的证据文本 */
  text: string
  returned: number
  hitCount: number
  partial: boolean
  coverage: number
  truncated: boolean
  timeRange?: { earliest: string; latest: string }
  sources: SemanticSearchToolSource[]
}

export interface SemanticSearchToolOptions {
  /** 期望返回片段数；未指定时由 service 用配置默认值 */
  maxResults?: number
  /** 预处理配置（脱敏/匿名化/清洗规则） */
  preprocessConfig?: Record<string, unknown>
  /** 当前用户平台 id，用于昵称匿名化 owner 识别 */
  ownerPlatformId?: string
  locale?: string
  /** 证据文本 token 预算 */
  maxResultTokens?: number
  /** 毫秒级时间范围过滤（可单边）；仅保留与 chunk 时间范围有交集的语义候选 */
  timeFilter?: EvidenceTimeRangeMs
}

/**
 * 语义检索窄接口
 *
 * 由 node-runtime 的 SemanticIndexService 实现并经 adapter 注入。
 * 工具层只消费已脱敏的安全结果，脱敏在 service 内通过 applyPreprocessingPipeline 完成。
 */
export interface SemanticSearchToolService {
  /** 当前会话是否可检索（已启用 + 有 chunk + 模型一致） */
  canSearch(sessionId: string): boolean | Promise<boolean>
  searchForTool(
    sessionId: string,
    query: string,
    options?: SemanticSearchToolOptions
  ): Promise<SemanticSearchToolResult>
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
  timeFilter?: ToolTimeRange
  abortSignal?: AbortSignal
  /** 抽象查询接口 */
  dataProvider?: ToolDataProvider
  /** 语义检索窄接口（仅当前会话可检索时由 adapter 注入） */
  semanticIndexService?: SemanticSearchToolService
  /** 预处理配置（脱敏/匿名化/清洗），供需要自处理的工具（如语义检索）使用 */
  preprocessConfig?: Record<string, unknown>
  /** 当前用户平台 id，用于昵称匿名化 owner 识别 */
  ownerPlatformId?: string
  /** @deprecated 逐步迁移到 dataProvider 后移除；Electron 端不提供此字段 */
  db?: DatabaseAdapter
  /** 搜索结果上下文：向前取多少条 */
  searchContextBefore?: number
  /** 搜索结果上下文：向后取多少条 */
  searchContextAfter?: number
  /** 消息条数上限 */
  maxMessagesLimit?: number
  /** 工具结果 token 预算（语义检索证据文本截断用） */
  maxToolResultTokens?: number
  /** NLP 分词回调（由平台注入 batchSegmentWithFrequency 实现） */
  segmentText?: (texts: string[], locale: string, options: Record<string, unknown>) => SegmentResult
  /** i18n 模板翻译回调（用于 SQL 工具模板国际化） */
  translateTemplate?: (key: string) => string | undefined
  /**
   * 消息脱敏回调：对一组原始消息执行清洗 + 脱敏，返回安全消息（含 id/发送者/时间/脱敏后内容）。
   *
   * 供需要在工具内部生成可持久化安全 snippet 的工具使用（如证据检索的关键词路径）。
   * 由平台 adapter 注入 applyPreprocessingPipeline 等价实现；清洗可能删除/合并消息，
   * 返回条数可能少于输入。未注入时调用方应回退到不脱敏或跳过相关能力。
   */
  desensitizeMessages?: (messages: RawMessage[], options?: { anonymizeNames?: boolean }) => RawMessage[]
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
