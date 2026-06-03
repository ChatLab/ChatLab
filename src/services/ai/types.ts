import type { TimeFilter } from '@/types/base'

export interface AIConversation {
  id: string
  sessionId: string
  title: string | null
  assistantId: string
  activeMessageId?: string | null
  createdAt: number
  updatedAt: number
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'think'; tag: string; text: string; durationMs?: number }
  | {
      type: 'tool'
      tool: {
        name: string
        displayName: string
        status: 'running' | 'done' | 'error'
        params?: Record<string, unknown>
      }
    }
  | { type: 'skill'; skillId: string; skillName: string }
  | { type: 'error'; error: { name: string | null; message: string; stack: string | null } }
  | { type: 'summary_meta'; bufferBoundaryTimestamp: number; compressedMessageCount: number }

export type AIMessageRole = 'user' | 'assistant' | 'summary'

export interface TokenUsageData {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface AIMessage {
  id: string
  conversationId: string
  role: AIMessageRole
  content: string
  timestamp: number
  parentId?: string | null
  dataKeywords?: string[]
  dataMessageCount?: number
  contentBlocks?: ContentBlock[]
  tokenUsage?: TokenUsageData
}

export interface DesensitizeRule {
  id: string
  label: string
  pattern: string
  replacement: string
  enabled: boolean
  builtin: boolean
  locales: string[]
  group?: string
}

export interface ToolCatalogEntry {
  name: string
  category: 'core' | 'analysis'
  description: string
  parameters: Record<string, unknown>
}

export interface ToolExecuteResult {
  success: boolean
  elapsed?: number
  content?: Array<{ type: string; text: string }>
  details?: Record<string, unknown>
  error?: string
  truncated?: boolean
}

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
  isHit: boolean
}

export interface ContextBlock {
  startTs: number
  endTs: number
  messages: FilterMessage[]
  hitCount: number
}

export interface FilterStats {
  totalMessages: number
  hitMessages: number
  totalChars: number
}

export interface PaginationInfo {
  page: number
  pageSize: number
  totalBlocks: number
  totalHits: number
  hasMore: boolean
}

export interface FilterResultWithPagination {
  blocks: ContextBlock[]
  stats: FilterStats
  pagination: PaginationInfo
}

export interface ExportFilterParams {
  sessionId: string
  sessionName: string
  outputDir: string
  filterMode: 'condition' | 'session'
  keywords?: string[]
  timeFilter?: TimeFilter
  senderIds?: number[]
  contextSize?: number
  chatSessionIds?: number[]
}

export interface ExportProgress {
  stage: 'preparing' | 'exporting' | 'done' | 'error'
  currentBlock: number
  totalBlocks: number
  percentage: number
  message: string
}

export interface AiSchemaTable {
  name: string
  columns: Array<{ name: string; type: string; notnull: boolean; pk: boolean }>
}

export interface AiSQLResult {
  columns: string[]
  rows: unknown[][]
  rowCount: number
  duration: number
  limited: boolean
}

export interface AIAdapter {
  // ===== 对话管理 =====
  getConversation(conversationId: string): Promise<AIConversation | null>
  getConversations(sessionId: string): Promise<AIConversation[]>
  createConversation(sessionId: string, title: string | undefined, assistantId: string): Promise<AIConversation>
  updateConversationTitle(conversationId: string, title: string): Promise<boolean>
  deleteConversation(conversationId: string): Promise<boolean>

  // ===== 消息 =====
  getMessages(conversationId: string): Promise<AIMessage[]>
  addMessage(
    conversationId: string,
    role: AIMessageRole,
    content: string,
    dataKeywords?: string[],
    dataMessageCount?: number,
    contentBlocks?: ContentBlock[],
    tokenUsage?: TokenUsageData
  ): Promise<AIMessage>
  deleteMessagesFrom(conversationId: string, messageId: string): Promise<void>
  forkConversation(sourceConversationId: string, upToMessageId: string, title?: string): Promise<AIConversation>
  updateMessageContent(messageId: string, newContent: string): Promise<void>
  deleteAndRelinkMessage(conversationId: string, messageId: string): Promise<void>
  insertMessageAfter(
    conversationId: string,
    afterMessageId: string,
    role: AIMessageRole,
    content: string,
    contentBlocks?: ContentBlock[],
    tokenUsage?: TokenUsageData
  ): Promise<AIMessage>
  getConversationTokenUsage(conversationId: string): Promise<TokenUsageData>
  estimateContextTokens(
    conversationId: string
  ): Promise<{ success: boolean; tokens: number; messageCount?: number; error?: string }>

  // ===== 消息筛选/导出 =====
  filterMessagesWithContext(
    sessionId: string,
    keywords?: string[],
    timeFilter?: TimeFilter,
    senderIds?: number[],
    contextSize?: number,
    page?: number,
    pageSize?: number
  ): Promise<FilterResultWithPagination>
  getMultipleSessionsMessages(
    sessionId: string,
    chatSessionIds: number[],
    page?: number,
    pageSize?: number
  ): Promise<FilterResultWithPagination>
  exportFilterResultToFile(params: ExportFilterParams): Promise<{ success: boolean; filePath?: string; error?: string }>
  onExportProgress(callback: (progress: ExportProgress) => void): () => void

  // ===== 调试 =====
  executeAiSQL(sql: string): Promise<AiSQLResult>
  getAiSchema(): Promise<AiSchemaTable[]>
  clearDebugContext(): Promise<{ success: boolean; cleared: number }>

  // ===== 工具 =====
  getToolCatalog(): Promise<ToolCatalogEntry[]>
  executeTool(
    testId: string,
    toolName: string,
    params: Record<string, unknown>,
    sessionId: string
  ): Promise<ToolExecuteResult>
  cancelToolTest(testId: string): Promise<{ success: boolean }>

  // ===== 脱敏 =====
  getDefaultDesensitizeRules(locale: string): Promise<DesensitizeRule[]>
  mergeDesensitizeRules(
    existingRules: DesensitizeRule[],
    locale: string,
    overrides?: Record<string, boolean>
  ): Promise<DesensitizeRule[]>

  // ===== 日志 =====
  showAiLogFile(): Promise<{ success: boolean; path?: string; error?: string }>
}
