import { ElectronAPI } from '@electron-toolkit/preload'
import type { AnalysisSession, MessageType, ImportProgress, ExportProgress } from '../../src/types/base'
import type { TokenUsage, AgentRuntimeStatus, SerializedErrorInfo } from '../shared/types'
import type {
  MemberActivity,
  MemberNameHistory,
  HourlyActivity,
  DailyActivity,
  WeekdayActivity,
  MonthlyActivity,
  CatchphraseAnalysis,
  MentionAnalysis,
  LaughAnalysis,
  MemberWithStats,
  ClusterGraphData,
  ClusterGraphOptions,
  RelationshipStats,
} from '../../src/types/analysis'
import type { FileParseInfo, ConflictCheckResult, MergeParams, MergeResult } from '../../src/types/format'
import type { LanguagePreferenceResult } from '../../src/types/quotes/languagePreference'
import type { TableSchema, SQLResult } from '../../src/components/analysis/SQLLab/types'

interface TimeFilter {
  startTs?: number
  endTs?: number
  memberId?: number | null // 成员筛选，null 表示全部成员
}

// @ 互动关系图数据
interface MentionGraphData {
  nodes: Array<{ id: number; name: string; value: number; symbolSize: number }>
  links: Array<{ source: string; target: string; value: number }>
  maxLinkValue: number
}

// 迁移相关类型
interface MigrationInfo {
  version: number
  description: string
  userMessage: string
}

interface MigrationCheckResult {
  needsMigration: boolean
  count: number
  currentVersion: number
  pendingMigrations: MigrationInfo[]
}

// 导入诊断信息
interface ImportDiagnostics {
  /** 日志文件路径 */
  logFile: string | null
  /** 检测到的格式 */
  detectedFormat: string | null
  /** 收到的消息数 */
  messagesReceived: number
  /** 写入的消息数 */
  messagesWritten: number
  /** 跳过的消息数 */
  messagesSkipped: number
  /** 跳过原因统计 */
  skipReasons: {
    noSenderId: number
    noAccountName: number
    invalidTimestamp: number
    noType: number
  }
}

interface ChatApi {
  selectFile: () => Promise<{
    filePath?: string
    format?: string
    error?: string
  } | null>
  detectFormat: (filePath: string) => Promise<{ id: string; name: string; platform: string; multiChat: boolean } | null>
  import: (filePath: string) => Promise<{
    success: boolean
    sessionId?: string
    error?: string
    diagnostics?: ImportDiagnostics
  }>
  importWithOptions: (
    filePath: string,
    formatOptions: Record<string, unknown>
  ) => Promise<{
    success: boolean
    sessionId?: string
    error?: string
    diagnostics?: ImportDiagnostics
  }>
  scanMultiChatFile: (filePath: string) => Promise<{
    success: boolean
    chats: Array<{ index: number; name: string; type: string; id: number; messageCount: number }>
    error?: string
  }>
  getSessions: () => Promise<AnalysisSession[]>
  getSession: (sessionId: string) => Promise<AnalysisSession | null>
  deleteSession: (sessionId: string) => Promise<boolean>
  renameSession: (sessionId: string, newName: string) => Promise<boolean>
  // 迁移相关
  checkMigration: () => Promise<MigrationCheckResult>
  runMigration: () => Promise<{ success: boolean; error?: string }>
  // 会话所有者
  updateSessionOwnerId: (sessionId: string, ownerId: string | null) => Promise<boolean>
  getAvailableYears: (sessionId: string) => Promise<number[]>
  getMemberActivity: (sessionId: string, filter?: TimeFilter) => Promise<MemberActivity[]>
  getMemberNameHistory: (sessionId: string, memberId: number) => Promise<MemberNameHistory[]>
  getHourlyActivity: (sessionId: string, filter?: TimeFilter) => Promise<HourlyActivity[]>
  getDailyActivity: (sessionId: string, filter?: TimeFilter) => Promise<DailyActivity[]>
  getWeekdayActivity: (sessionId: string, filter?: TimeFilter) => Promise<WeekdayActivity[]>
  getMonthlyActivity: (sessionId: string, filter?: TimeFilter) => Promise<MonthlyActivity[]>
  getYearlyActivity: (sessionId: string, filter?: TimeFilter) => Promise<Array<{ year: number; messageCount: number }>>
  getMessageLengthDistribution: (
    sessionId: string,
    filter?: TimeFilter
  ) => Promise<{
    detail: Array<{ len: number; count: number }>
    grouped: Array<{ range: string; count: number }>
  }>
  getMessageTypeDistribution: (
    sessionId: string,
    filter?: TimeFilter
  ) => Promise<Array<{ type: MessageType; count: number }>>
  getTimeRange: (sessionId: string) => Promise<{ start: number; end: number } | null>
  getDbDirectory: () => Promise<string | null>
  getSupportedFormats: () => Promise<Array<{ id: string; name: string; platform: string; extensions: string[] }>>
  onImportProgress: (callback: (progress: ImportProgress) => void) => () => void
  getCatchphraseAnalysis: (sessionId: string, filter?: TimeFilter) => Promise<CatchphraseAnalysis>
  getLanguagePreferenceAnalysis: (
    sessionId: string,
    locale: string,
    filter?: TimeFilter,
    dictType?: string
  ) => Promise<LanguagePreferenceResult>
  getMentionAnalysis: (sessionId: string, filter?: TimeFilter) => Promise<MentionAnalysis>
  getMentionGraph: (sessionId: string, filter?: TimeFilter) => Promise<MentionGraphData>
  getClusterGraph: (sessionId: string, filter?: TimeFilter, options?: ClusterGraphOptions) => Promise<ClusterGraphData>
  getLaughAnalysis: (sessionId: string, filter?: TimeFilter, keywords?: string[]) => Promise<LaughAnalysis>
  getRelationshipStats: (
    sessionId: string,
    filter?: TimeFilter,
    options?: { perseveranceThreshold?: number }
  ) => Promise<RelationshipStats>
  // 成员管理
  getMembers: (sessionId: string) => Promise<MemberWithStats[]>
  getMembersPaginated: (
    sessionId: string,
    params: { page: number; pageSize: number; search?: string; sortOrder?: 'asc' | 'desc' }
  ) => Promise<{
    members: MemberWithStats[]
    total: number
    page: number
    pageSize: number
    totalPages: number
  }>
  updateMemberAliases: (sessionId: string, memberId: number, aliases: string[]) => Promise<boolean>
  mergeMembers: (sessionId: string, memberId1: number, memberId2: number) => Promise<boolean>
  deleteMember: (sessionId: string, memberId: number) => Promise<boolean>
  // 插件系统
  pluginQuery: <T = Record<string, any>>(sessionId: string, sql: string, params?: any[]) => Promise<T[]>
  pluginCompute: <T = any>(fnString: string, input: any) => Promise<T>
  // SQL 实验室
  getSchema: (sessionId: string) => Promise<TableSchema[]>
  executeSQL: (sessionId: string, sql: string) => Promise<SQLResult>
  // 增量导入
  analyzeIncrementalImport: (
    sessionId: string,
    filePath: string
  ) => Promise<{
    newMessageCount: number
    duplicateCount: number
    totalInFile: number
    error?: string
    diagnosis?: { suggestion?: string }
  }>
  incrementalImport: (
    sessionId: string,
    filePath: string
  ) => Promise<{
    success: boolean
    newMessageCount: number
    error?: string
  }>
  exportSessionsToTempFiles: (sessionIds: string[]) => Promise<{
    success: boolean
    tempFiles: string[]
    error?: string
  }>
  cleanupTempExportFiles: (filePaths: string[]) => Promise<{
    success: boolean
    error?: string
  }>
}

interface Api {
  send: (channel: string, data?: unknown) => void
  receive: (channel: string, func: (...args: unknown[]) => void) => void
  removeListener: (channel: string, func: (...args: unknown[]) => void) => void
  setThemeSource: (mode: 'system' | 'light' | 'dark') => void
  dialog: {
    showOpenDialog: (options: Electron.OpenDialogOptions) => Promise<Electron.OpenDialogReturnValue>
  }
  clipboard: {
    copyImage: (dataUrl: string) => Promise<{ success: boolean; error?: string }>
  }
  app: {
    getVersion: () => Promise<string>
    checkUpdate: () => void
    simulateUpdate: () => void
    fetchRemoteConfig: (url: string) => Promise<{ success: boolean; data?: unknown; error?: string }>
    getAnalyticsEnabled: () => Promise<boolean>
    setAnalyticsEnabled: (enabled: boolean) => Promise<{ success: boolean }>
    relaunch: () => Promise<void>
    getOpenAtLogin: () => Promise<boolean>
    setOpenAtLogin: (enabled: boolean) => Promise<{ success: boolean; error?: string }>
  }
}

interface MergeApi {
  parseFileInfo: (filePath: string) => Promise<FileParseInfo>
  checkConflicts: (filePaths: string[]) => Promise<ConflictCheckResult>
  mergeFiles: (params: MergeParams) => Promise<MergeResult>
  clearCache: (filePath?: string) => Promise<boolean>
}

// AI 相关类型
interface SearchMessageResult {
  id: number
  senderName: string
  senderPlatformId: string
  senderAliases: string[]
  senderAvatar: string | null
  content: string
  timestamp: number
  type: number
}

interface FilterMessage {
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

interface ContextBlock {
  startTs: number
  endTs: number
  messages: FilterMessage[]
  hitCount: number
}

interface FilterResult {
  blocks: ContextBlock[]
  stats: {
    totalMessages: number
    hitMessages: number
    totalChars: number
  }
}

// 分页信息类型
interface PaginationInfo {
  page: number
  pageSize: number
  totalBlocks: number
  totalHits: number
  hasMore: boolean
}

// 带分页的筛选结果类型
interface FilterResultWithPagination extends FilterResult {
  pagination: PaginationInfo
}

interface AIConversation {
  id: string
  sessionId: string
  title: string | null
  assistantId: string
  createdAt: number
  updatedAt: number
}

// 内容块类型（用于 AI 消息的混合渲染）
type AIContentBlock =
  | { type: 'text'; text: string }
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
  | {
      type: 'summary_meta'
      bufferBoundaryTimestamp: number
      compressedMessageCount: number
    }

type AIMessageRole = 'user' | 'assistant' | 'summary'

interface AITokenUsageData {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

interface AIMessage {
  id: string
  conversationId: string
  role: AIMessageRole
  content: string
  timestamp: number
  dataKeywords?: string[]
  dataMessageCount?: number
  contentBlocks?: AIContentBlock[]
  tokenUsage?: AITokenUsageData
}

interface AiApi {
  searchMessages: (
    sessionId: string,
    keywords: string[],
    filter?: TimeFilter,
    limit?: number,
    offset?: number,
    senderId?: number
  ) => Promise<{ messages: SearchMessageResult[]; total: number }>
  getMessageContext: (
    sessionId: string,
    messageIds: number | number[],
    contextSize?: number
  ) => Promise<SearchMessageResult[]>
  getRecentMessages: (
    sessionId: string,
    filter?: TimeFilter,
    limit?: number
  ) => Promise<{ messages: SearchMessageResult[]; total: number }>
  getAllRecentMessages: (
    sessionId: string,
    filter?: TimeFilter,
    limit?: number
  ) => Promise<{ messages: SearchMessageResult[]; total: number }>
  getConversationBetween: (
    sessionId: string,
    memberId1: number,
    memberId2: number,
    filter?: TimeFilter,
    limit?: number
  ) => Promise<{ messages: SearchMessageResult[]; total: number; member1Name: string; member2Name: string }>
  getMessagesBefore: (
    sessionId: string,
    beforeId: number,
    limit?: number,
    filter?: TimeFilter,
    senderId?: number,
    keywords?: string[]
  ) => Promise<{ messages: SearchMessageResult[]; hasMore: boolean }>
  getMessagesAfter: (
    sessionId: string,
    afterId: number,
    limit?: number,
    filter?: TimeFilter,
    senderId?: number,
    keywords?: string[]
  ) => Promise<{ messages: SearchMessageResult[]; hasMore: boolean }>
  createConversation: (sessionId: string, title: string | undefined, assistantId: string) => Promise<AIConversation>
  getConversations: (sessionId: string) => Promise<AIConversation[]>
  getConversation: (conversationId: string) => Promise<AIConversation | null>
  updateConversationTitle: (conversationId: string, title: string) => Promise<boolean>
  deleteConversation: (conversationId: string) => Promise<boolean>
  addMessage: (
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    dataKeywords?: string[],
    dataMessageCount?: number,
    contentBlocks?: AIContentBlock[],
    tokenUsage?: AITokenUsageData
  ) => Promise<AIMessage>
  getMessages: (conversationId: string) => Promise<AIMessage[]>
  getMessages: (conversationId: string) => Promise<AIMessage[]>
  getConversationTokenUsage: (conversationId: string) => Promise<AITokenUsageData>
  deleteMessage: (messageId: string) => Promise<boolean>
  showAiLogFile: () => Promise<{ success: boolean; path?: string; error?: string }>
  clearDebugContext: () => Promise<{ success: boolean; cleared: number }>
  getDefaultDesensitizeRules: (locale: string) => Promise<DesensitizeRule[]>
  mergeDesensitizeRules: (existingRules: DesensitizeRule[], locale: string) => Promise<DesensitizeRule[]>
  getToolCatalog: () => Promise<ToolCatalogEntry[]>
  executeTool: (
    testId: string,
    toolName: string,
    params: Record<string, unknown>,
    sessionId: string
  ) => Promise<ToolExecuteResult>
  cancelToolTest: (testId: string) => Promise<{ success: boolean }>
  estimateContextTokens: (
    conversationId: string
  ) => Promise<{ success: boolean; tokens: number; messageCount?: number; error?: string }>
  compressContext: (
    conversationId: string,
    compressionConfig: {
      enabled: boolean
      tokenThresholdPercent: number
      bufferSizePercent: number
      maxToolResultPercent?: number
    },
    systemPrompt: string
  ) => Promise<{
    success: boolean
    result?: {
      compressed: boolean
      reason: string
      tokensBefore?: number
      tokensAfter?: number
      error?: string
    }
    error?: string
  }>
  // 自定义筛选（支持分页）
  filterMessagesWithContext: (
    sessionId: string,
    keywords?: string[],
    timeFilter?: TimeFilter,
    senderIds?: number[],
    contextSize?: number,
    page?: number,
    pageSize?: number
  ) => Promise<FilterResultWithPagination>
  getMultipleSessionsMessages: (
    sessionId: string,
    chatSessionIds: number[],
    page?: number,
    pageSize?: number
  ) => Promise<FilterResultWithPagination>
  // 导出筛选结果到文件
  exportFilterResultToFile: (params: {
    sessionId: string
    sessionName: string
    outputDir: string
    filterMode: 'condition' | 'session'
    keywords?: string[]
    timeFilter?: TimeFilter
    senderIds?: number[]
    contextSize?: number
    chatSessionIds?: number[]
  }) => Promise<{ success: boolean; filePath?: string; error?: string }>
  // 监听导出进度
  onExportProgress: (callback: (progress: ExportProgress) => void) => () => void
  // [Debug] AI 数据库直接访问
  getAiSchema: () => Promise<
    Array<{ name: string; columns: Array<{ name: string; type: string; notnull: boolean; pk: boolean }> }>
  >
  executeAiSQL: (sql: string) => Promise<{
    columns: string[]
    rows: any[][]
    rowCount: number
    duration: number
    limited: boolean
  }>
}

// ==================== 新模型系统类型 ====================

type ProviderKind = 'official' | 'aggregator' | 'openai-compatible'

interface ProviderDefinition {
  id: string
  name: string
  kind: ProviderKind
  website?: string
  consoleUrl?: string
  defaultBaseUrl: string
  authMode: 'api-key'
  supportsCustomModels: boolean
  builtin: boolean
  enabledByDefault: boolean
  modelIds: string[]
}

type ModelCapability = 'chat' | 'reasoning' | 'vision' | 'function_calling' | 'embedding' | 'ranking'
type ModelStatus = 'stable' | 'preview' | 'deprecated'
type ModelRecommendedFor = 'chat' | 'embedding' | 'rerank'

interface ModelDefinition {
  id: string
  providerId: string
  name: string
  description?: string
  capabilities: ModelCapability[]
  recommendedFor: ModelRecommendedFor[]
  status: ModelStatus
  builtin: boolean
  editable: boolean
}

// LLM 相关类型（旧，兼容）
interface LLMProviderInfo {
  id: string
  name: string
  defaultBaseUrl: string
  models: Array<{ id: string; name: string; description?: string }>
}

// 单个 AI 服务配置（前端显示用，API Key 已脱敏）
interface AIServiceConfigDisplay {
  id: string
  name: string
  provider: string
  apiKey: string // 脱敏后的 API Key
  apiKeySet: boolean
  model?: string
  baseUrl?: string
  maxTokens?: number
  apiFormat?: string
  disableThinking?: boolean
  isReasoningModel?: boolean
  createdAt: number
  updatedAt: number
}

interface LLMChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface LLMChatOptions {
  temperature?: number
  maxTokens?: number
}

interface LLMChatStreamChunk {
  content: string
  isFinished: boolean
  finishReason?: 'stop' | 'length' | 'error'
}

interface LlmApi {
  // Provider Registry / Model Catalog
  getProviderRegistry: () => Promise<ProviderDefinition[]>
  getModelCatalog: () => Promise<ModelDefinition[]>
  addCustomProvider: (
    input: Omit<ProviderDefinition, 'id' | 'builtin' | 'enabledByDefault'>
  ) => Promise<{ success: boolean; provider?: ProviderDefinition; error?: string }>
  updateCustomProvider: (
    id: string,
    updates: Partial<Omit<ProviderDefinition, 'id' | 'builtin'>>
  ) => Promise<{ success: boolean; error?: string }>
  deleteCustomProvider: (id: string) => Promise<{ success: boolean; error?: string }>
  addCustomModel: (
    input: Omit<ModelDefinition, 'builtin' | 'editable'>
  ) => Promise<{ success: boolean; model?: ModelDefinition; error?: string }>
  updateCustomModel: (
    providerId: string,
    modelId: string,
    updates: Partial<Omit<ModelDefinition, 'id' | 'providerId' | 'builtin'>>
  ) => Promise<{ success: boolean; error?: string }>
  deleteCustomModel: (providerId: string, modelId: string) => Promise<{ success: boolean; error?: string }>

  getProviders: () => Promise<LLMProviderInfo[]>

  // 多配置管理 API
  getAllConfigs: () => Promise<AIServiceConfigDisplay[]>
  getDefaultAssistantSlot: () => Promise<{ configId: string; modelId: string } | null>
  getFastModelSlot: () => Promise<{ configId: string; modelId: string } | null>
  addConfig: (config: {
    name: string
    provider: string
    apiKey: string
    model?: string
    baseUrl?: string
    maxTokens?: number
    apiFormat?: string
    disableThinking?: boolean
    isReasoningModel?: boolean
    customModels?: Array<{ id: string; name: string }>
  }) => Promise<{ success: boolean; config?: AIServiceConfigDisplay; error?: string }>
  updateConfig: (
    id: string,
    updates: {
      name?: string
      provider?: string
      apiKey?: string
      model?: string
      baseUrl?: string
      maxTokens?: number
      apiFormat?: string
      disableThinking?: boolean
      isReasoningModel?: boolean
      customModels?: Array<{ id: string; name: string }>
    }
  ) => Promise<{ success: boolean; error?: string }>
  deleteConfig: (id?: string) => Promise<{ success: boolean; error?: string }>
  setDefaultAssistantModel: (configId: string, modelId: string) => Promise<{ success: boolean; error?: string }>
  setFastModel: (slot: { configId: string; modelId: string } | null) => Promise<{ success: boolean; error?: string }>

  // 验证和检查
  validateApiKey: (
    provider: string,
    apiKey: string,
    baseUrl?: string,
    model?: string
  ) => Promise<{ success: boolean; error?: string }>
  fetchRemoteModels: (
    provider: string,
    apiKey: string,
    baseUrl?: string,
    apiFormat?: string
  ) => Promise<{
    success: boolean
    models?: Array<{ id: string; name: string; ownedBy?: string; contextWindow?: number }>
    error?: string
  }>
  hasConfig: () => Promise<boolean>

  // 聊天功能
  chat: (
    messages: LLMChatMessage[],
    options?: LLMChatOptions
  ) => Promise<{ success: boolean; content?: string; error?: string }>
  chatStream: (
    messages: LLMChatMessage[],
    options?: LLMChatOptions,
    onChunk?: (chunk: LLMChatStreamChunk) => void
  ) => Promise<{ success: boolean; error?: string }>
}

// ==================== Embedding 多配置相关类型 ====================

interface EmbeddingServiceConfig {
  id: string
  name: string
  apiSource: 'reuse_llm' | 'custom'
  model: string
  baseUrl?: string
  apiKey?: string
  createdAt: number
  updatedAt: number
}

interface EmbeddingServiceConfigDisplay {
  id: string
  name: string
  apiSource: 'reuse_llm' | 'custom'
  model: string
  baseUrl?: string
  apiKeySet: boolean
  createdAt: number
  updatedAt: number
}

interface EmbeddingApi {
  getAllConfigs: () => Promise<EmbeddingServiceConfigDisplay[]>
  getConfig: (id: string) => Promise<EmbeddingServiceConfig | null>
  getActiveConfigId: () => Promise<string | null>
  isEnabled: () => Promise<boolean>
  addConfig: (
    config: Omit<EmbeddingServiceConfig, 'id' | 'createdAt' | 'updatedAt'>
  ) => Promise<{ success: boolean; config?: EmbeddingServiceConfig; error?: string }>
  updateConfig: (
    id: string,
    updates: Partial<Omit<EmbeddingServiceConfig, 'id' | 'createdAt' | 'updatedAt'>>
  ) => Promise<{ success: boolean; error?: string }>
  deleteConfig: (id: string) => Promise<{ success: boolean; error?: string }>
  setActiveConfig: (id: string) => Promise<{ success: boolean; error?: string }>
  validateConfig: (config: EmbeddingServiceConfig) => Promise<{ success: boolean; error?: string }>
  getVectorStoreStats: () => Promise<{
    enabled: boolean
    count?: number
    sizeBytes?: number
    error?: string
  }>
  clearVectorStore: () => Promise<{ success: boolean; error?: string }>
}

// ==================== 旧版 RAG 相关类型（兼容） ====================

interface EmbeddingConfig {
  enabled: boolean
  provider: 'api'
  apiSource?: 'reuse_llm' | 'custom'
  model?: string
  baseUrl?: string
  apiKey?: string
}

interface VectorStoreConfig {
  enabled: boolean
  type: 'memory' | 'sqlite' | 'lancedb'
  memoryCacheSize?: number
  dbPath?: string
}

interface RerankConfig {
  enabled: boolean
  provider: 'jina' | 'cohere' | 'bge' | 'custom'
  model?: string
  baseUrl?: string
  apiKey?: string
  topK?: number
}

interface RAGConfig {
  embedding?: EmbeddingConfig
  vectorStore?: VectorStoreConfig
  rerank?: RerankConfig
  enableSemanticPipeline?: boolean
  candidateLimit?: number
  topK?: number
}

// TokenUsage & AgentRuntimeStatus — imported from electron/shared/types.ts

// Agent 相关类型
interface AgentStreamChunk {
  type: 'content' | 'think' | 'tool_start' | 'tool_result' | 'status' | 'compression_done' | 'done' | 'error'
  content?: string
  thinkTag?: string
  thinkDurationMs?: number
  toolName?: string
  toolParams?: Record<string, unknown>
  toolResult?: unknown
  status?: AgentRuntimeStatus
  error?: SerializedErrorInfo
  isFinished?: boolean
  compressionResult?: {
    summaryContent: string
    tokensBefore: number
    tokensAfter: number
    timestamp: number
  }
  /** Token 使用量（type=done 时返回累计值） */
  usage?: TokenUsage
}

interface AgentResult {
  content: string
  toolsUsed: string[]
  toolRounds: number
  /** 总 Token 使用量（累计所有 LLM 调用） */
  totalUsage?: TokenUsage
  error?: SerializedErrorInfo
}

/** Owner 信息（当前用户在对话中的身份） */
interface OwnerInfo {
  /** Owner 的 platformId */
  platformId: string
  /** Owner 的显示名称 */
  displayName: string
}

/** 单条脱敏规则 */
interface DesensitizeRule {
  id: string
  label: string
  pattern: string
  replacement: string
  enabled: boolean
  builtin: boolean
  locales: string[]
}

/** 工具目录条目（实验室 - 基础工具） */
interface ToolCatalogEntry {
  name: string
  category: 'core' | 'analysis'
  description: string
  parameters: Record<string, unknown>
}

/** 工具执行结果 */
interface ToolExecuteResult {
  success: boolean
  elapsed?: number
  content?: Array<{ type: string; text: string }>
  details?: Record<string, unknown>
  error?: string
  truncated?: boolean
}

/** 聊天记录预处理配置 */
interface PreprocessConfig {
  dataCleaning: boolean
  mergeConsecutive: boolean
  mergeWindowSeconds?: number
  blacklistKeywords: string[]
  denoise: boolean
  desensitize: boolean
  desensitizeRules: DesensitizeRule[]
  anonymizeNames: boolean
}

interface ToolContext {
  sessionId: string
  conversationId?: string
  timeFilter?: { startTs: number; endTs: number }
  /** 用户配置：每次发送给 AI 的最大消息条数 */
  maxMessagesLimit?: number
  /** Owner 信息（当前用户在对话中的身份） */
  ownerInfo?: OwnerInfo
  /** 本轮显式 @ 的成员 */
  mentionedMembers?: Array<{
    memberId: number
    platformId: string
    displayName: string
    aliases: string[]
    mentionText: string
  }>
  /** 语言环境 */
  locale?: string
  /** 聊天记录预处理配置 */
  preprocessConfig?: PreprocessConfig
}

interface AgentApi {
  runStream: (
    userMessage: string,
    context: ToolContext,
    onChunk?: (chunk: AgentStreamChunk) => void,
    chatType?: 'group' | 'private',
    locale?: string,
    assistantId?: string,
    skillId?: string | null,
    enableAutoSkill?: boolean,
    compressionConfig?: {
      enabled: boolean
      tokenThresholdPercent: number
      bufferSizePercent: number
      maxToolResultPercent?: number
    }
  ) => { requestId: string; promise: Promise<{ success: boolean; result?: AgentResult; error?: SerializedErrorInfo }> }
  abort: (requestId: string) => Promise<{ success: boolean; error?: string }>
}

// ==================== 助手管理 ====================

interface AssistantSummary {
  id: string
  name: string
  systemPrompt: string
  presetQuestions: string[]
  builtinId?: string
  applicableChatTypes?: ('group' | 'private')[]
  supportedLocales?: string[]
}

interface AssistantConfigFull {
  id: string
  name: string
  systemPrompt: string
  presetQuestions: string[]
  allowedBuiltinTools?: string[]
  builtinId?: string
  applicableChatTypes?: ('group' | 'private')[]
  supportedLocales?: string[]
}

interface BuiltinAssistantInfo {
  id: string
  name: string
  systemPrompt: string
  applicableChatTypes?: ('group' | 'private')[]
  supportedLocales?: string[]
  imported: boolean
}

interface AssistantApi {
  getAll: () => Promise<AssistantSummary[]>
  getConfig: (id: string) => Promise<AssistantConfigFull | null>
  update: (id: string, updates: Partial<AssistantConfigFull>) => Promise<{ success: boolean; error?: string }>
  create: (config: Omit<AssistantConfigFull, 'id'>) => Promise<{ success: boolean; id?: string; error?: string }>
  delete: (id: string) => Promise<{ success: boolean; error?: string }>
  reset: (id: string) => Promise<{ success: boolean; error?: string }>
  getBuiltinCatalog: () => Promise<BuiltinAssistantInfo[]>
  getBuiltinToolCatalog: () => Promise<Array<{ name: string; category: 'core' | 'analysis' }>>
  importAssistant: (builtinId: string) => Promise<{ success: boolean; error?: string }>
  reimportAssistant: (id: string) => Promise<{ success: boolean; error?: string }>
  importFromMd: (rawMd: string) => Promise<{ success: boolean; id?: string; error?: string }>
}

// ==================== 技能管理 ====================

interface SkillSummary {
  id: string
  name: string
  description: string
  tags: string[]
  chatScope: 'all' | 'group' | 'private'
  tools: string[]
  builtinId?: string
}

interface SkillConfigFull {
  id: string
  name: string
  description: string
  tags: string[]
  chatScope: 'all' | 'group' | 'private'
  prompt: string
  tools: string[]
  builtinId?: string
}

interface BuiltinSkillInfo extends SkillSummary {
  imported: boolean
  hasUpdate: boolean
}

interface SkillApi {
  getAll: () => Promise<SkillSummary[]>
  getConfig: (id: string) => Promise<SkillConfigFull | null>
  update: (id: string, rawMd: string) => Promise<{ success: boolean; error?: string }>
  create: (rawMd: string) => Promise<{ success: boolean; id?: string; error?: string }>
  delete: (id: string) => Promise<{ success: boolean; error?: string }>
  getBuiltinCatalog: () => Promise<BuiltinSkillInfo[]>
  importSkill: (builtinId: string) => Promise<{ success: boolean; id?: string; error?: string }>
  reimportSkill: (id: string) => Promise<{ success: boolean; error?: string }>
  importFromMd: (rawMd: string) => Promise<{ success: boolean; id?: string; error?: string }>
}

// Cache API 类型
interface CacheDirectoryInfo {
  id: string
  name: string
  description: string
  path: string
  icon: string
  canClear: boolean
  size: number
  fileCount: number
  exists: boolean
}

interface CacheInfo {
  baseDir: string
  directories: CacheDirectoryInfo[]
  totalSize: number
}

interface DataDirInfo {
  path: string
  isCustom: boolean
}

interface CacheApi {
  getInfo: () => Promise<CacheInfo>
  clear: (cacheId: string) => Promise<{ success: boolean; error?: string; message?: string }>
  openDir: (cacheId: string) => Promise<{ success: boolean; error?: string }>
  saveToDownloads: (
    filename: string,
    dataUrl: string
  ) => Promise<{ success: boolean; filePath?: string; error?: string }>
  getLatestImportLog: () => Promise<{ success: boolean; path?: string; name?: string; error?: string }>
  showInFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>
  getDataDir: () => Promise<DataDirInfo>
  selectDataDir: () => Promise<{ success: boolean; path?: string; error?: string }>
  setDataDir: (
    path: string | null,
    migrate?: boolean
  ) => Promise<{ success: boolean; error?: string; from?: string; to?: string }>
}

// Network API 类型 - 网络代理配置
type ProxyMode = 'off' | 'system' | 'manual'

interface ProxyConfig {
  mode: ProxyMode // 代理模式：关闭、跟随系统、手动配置
  url: string // 仅 manual 模式使用
}

interface NetworkApi {
  getProxyConfig: () => Promise<ProxyConfig>
  saveProxyConfig: (config: ProxyConfig) => Promise<{ success: boolean; error?: string }>
  testProxyConnection: (proxyUrl: string) => Promise<{ success: boolean; error?: string }>
}

// NLP API 类型 - 自然语言处理功能
type SupportedLocale = 'zh-CN' | 'en-US' | 'zh-TW' | 'ja-JP'

/** 词性过滤模式 */
type PosFilterMode = 'all' | 'meaningful' | 'custom'

interface WordFrequencyItem {
  word: string
  count: number
  percentage: number
}

interface PosTagStat {
  tag: string
  count: number
}

interface WordFrequencyResult {
  words: WordFrequencyItem[]
  totalWords: number
  totalMessages: number
  uniqueWords: number
  posTagStats?: PosTagStat[]
}

type DictType = 'default' | 'zh-CN' | 'zh-TW'

interface DictInfo {
  id: string
  label: string
  locale: string
  downloaded: boolean
  fileSize?: number
}

interface WordFrequencyParams {
  sessionId: string
  locale: SupportedLocale
  timeFilter?: { startTs?: number; endTs?: number }
  memberId?: number
  topN?: number
  minWordLength?: number
  minCount?: number
  /** 词性过滤模式：all=全部, meaningful=只保留有意义的词, custom=自定义 */
  posFilterMode?: PosFilterMode
  /** 自定义词性过滤列表（posFilterMode='custom' 时使用） */
  customPosTags?: string[]
  /** 是否启用停用词过滤，默认 true */
  enableStopwords?: boolean
  /** 词库类型：default=内置简体中文, zh-TW=繁体中文 */
  dictType?: DictType
  /** 要排除的词语列表（词云过滤方案） */
  excludeWords?: string[]
}

/** 词性标签信息 */
interface PosTagInfo {
  tag: string
  name: string
  description: string
  meaningful: boolean
}

interface NlpApi {
  getWordFrequency: (params: WordFrequencyParams) => Promise<WordFrequencyResult>
  segmentText: (text: string, locale: SupportedLocale, minLength?: number) => Promise<string[]>
  getPosTags: () => Promise<PosTagInfo[]>
  getDictList: () => Promise<DictInfo[]>
  isDictDownloaded: (dictId: string) => Promise<boolean>
  downloadDict: (dictId: string) => Promise<{ success: boolean; error?: string }>
  deleteDict: (dictId: string) => Promise<{ success: boolean; error?: string }>
}

// ChatLab API 服务类型
interface ApiServerConfig {
  enabled: boolean
  port: number
  token: string
  createdAt: number
}

interface ApiServerStatus {
  running: boolean
  port: number | null
  startedAt: number | null
  error: string | null
}

interface ImportSession {
  id: string
  name: string
  remoteSessionId: string
  targetSessionId: string
  lastPullAt: number
  lastStatus: 'idle' | 'success' | 'error'
  lastError: string
  lastNewMessages: number
}

interface DataSource {
  id: string
  name: string
  baseUrl: string
  token: string
  intervalMinutes: number
  pullLimit: number
  enabled: boolean
  createdAt: number
  sessions: ImportSession[]
}

interface RemoteSession {
  id: string
  name: string
  platform: string
  type: string
  messageCount?: number
  memberCount?: number
  lastMessageAt?: number
}

interface RemoteSessionDiscoveryPage {
  hasMore: boolean
  nextCursor?: string
}

interface RemoteSessionDiscoveryResult {
  sessions: RemoteSession[]
  page?: RemoteSessionDiscoveryPage
}

interface ApiServerApi {
  getConfig: () => Promise<ApiServerConfig>
  getStatus: () => Promise<ApiServerStatus>
  setEnabled: (enabled: boolean) => Promise<ApiServerStatus>
  setPort: (port: number) => Promise<ApiServerStatus>
  regenerateToken: () => Promise<ApiServerConfig>
  onStartupError: (callback: (data: { error: string }) => void) => () => void
  getDataSources: () => Promise<DataSource[]>
  addDataSource: (partial: {
    name?: string
    baseUrl: string
    token: string
    intervalMinutes: number
    pullLimit?: number
  }) => Promise<DataSource>
  updateDataSource: (
    id: string,
    updates: Partial<Pick<DataSource, 'name' | 'baseUrl' | 'token' | 'intervalMinutes' | 'pullLimit' | 'enabled'>>
  ) => Promise<DataSource | null>
  deleteDataSource: (id: string) => Promise<boolean>
  addImportSessions: (
    sourceId: string,
    sessions: Array<{ name: string; remoteSessionId: string }>
  ) => Promise<ImportSession[]>
  removeImportSession: (sourceId: string, sessionId: string) => Promise<boolean>
  triggerPull: (sourceId: string, sessionId?: string) => Promise<{ success: boolean; error?: string }>
  triggerPullAll: (sourceId: string) => Promise<{ success: boolean; error?: string }>
  fetchRemoteSessions: (
    baseUrl: string,
    token?: string,
    query?: { keyword?: string; limit?: number; cursor?: string }
  ) => Promise<RemoteSessionDiscoveryResult>
  onPullResult: (
    callback: (data: { sourceId: string; sessionId?: string; status: string; detail: string }) => void
  ) => () => void
  onImportCompleted: (callback: () => void) => () => void
}

// Session Index API 类型 - 会话索引功能
interface SessionStats {
  sessionCount: number
  hasIndex: boolean
  gapThreshold: number
}

interface ChatSessionItem {
  id: number
  startTs: number
  endTs: number
  messageCount: number
  firstMessageId: number
  /** 会话摘要（如果有） */
  summary?: string | null
}

interface SessionApi {
  generate: (sessionId: string, gapThreshold?: number) => Promise<number>
  hasIndex: (sessionId: string) => Promise<boolean>
  getStats: (sessionId: string) => Promise<SessionStats>
  clear: (sessionId: string) => Promise<boolean>
  updateGapThreshold: (sessionId: string, gapThreshold: number | null) => Promise<boolean>
  getSessions: (sessionId: string) => Promise<ChatSessionItem[]>
  /** 生成单个会话摘要 */
  generateSummary: (
    dbSessionId: string,
    chatSessionId: number,
    locale?: string,
    forceRegenerate?: boolean
  ) => Promise<{ success: boolean; summary?: string; error?: string }>
  /** 批量生成会话摘要 */
  generateSummaries: (
    dbSessionId: string,
    chatSessionIds: number[],
    locale?: string
  ) => Promise<{ success: number; failed: number; skipped: number }>
  /** 批量检查会话是否可以生成摘要 */
  checkCanGenerateSummary: (
    dbSessionId: string,
    chatSessionIds: number[]
  ) => Promise<Record<number, { canGenerate: boolean; reason?: string }>>
  /** 根据时间范围查询会话列表 */
  getByTimeRange: (
    dbSessionId: string,
    startTs: number,
    endTs: number
  ) => Promise<
    Array<{
      id: number
      startTs: number
      endTs: number
      messageCount: number
      summary: string | null
    }>
  >
  /** 获取最近 N 条会话 */
  getRecent: (
    dbSessionId: string,
    limit: number
  ) => Promise<
    Array<{
      id: number
      startTs: number
      endTs: number
      messageCount: number
      summary: string | null
    }>
  >
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
    chatApi: ChatApi
    mergeApi: MergeApi
    aiApi: AiApi
    llmApi: LlmApi
    embeddingApi: EmbeddingApi
    agentApi: AgentApi
    assistantApi: AssistantApi
    skillApi: SkillApi
    cacheApi: CacheApi
    networkApi: NetworkApi
    sessionApi: SessionApi
    nlpApi: NlpApi
    apiServerApi: ApiServerApi
  }
}

export {
  ChatApi,
  Api,
  MergeApi,
  AiApi,
  LlmApi,
  ProviderDefinition,
  ProviderKind,
  ModelDefinition,
  ModelCapability,
  ModelStatus,
  ModelRecommendedFor,
  EmbeddingApi,
  EmbeddingServiceConfig,
  EmbeddingServiceConfigDisplay,
  AgentApi,
  AssistantApi,
  AssistantSummary,
  AssistantConfigFull,
  BuiltinAssistantInfo,
  SkillApi,
  SkillSummary,
  SkillConfigFull,
  BuiltinSkillInfo,
  CacheApi,
  NetworkApi,
  NlpApi,
  ProxyConfig,
  SearchMessageResult,
  AIConversation,
  AIMessage,
  LLMProviderInfo,
  AIServiceConfigDisplay,
  LLMChatMessage,
  LLMChatOptions,
  LLMChatStreamChunk,
  AgentStreamChunk,
  AgentRuntimeStatus,
  AgentResult,
  SerializedErrorInfo,
  ToolContext,
  DesensitizeRule,
  PreprocessConfig,
  ToolCatalogEntry,
  ToolExecuteResult,
  TokenUsage,
  CacheDirectoryInfo,
  CacheInfo,
  FilterMessage,
  ContextBlock,
  FilterResult,
  RAGConfig,
  EmbeddingConfig,
  VectorStoreConfig,
  RerankConfig,
  WordFrequencyItem,
  WordFrequencyResult,
  WordFrequencyParams,
  SupportedLocale,
  PosFilterMode,
  PosTagInfo,
  ApiServerApi,
  ApiServerConfig,
  ApiServerStatus,
  DataSource,
  ImportSession,
}
