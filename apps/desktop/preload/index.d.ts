import { ElectronAPI } from '@electron-toolkit/preload'
import type { ImportProgress, ExportProgress } from '../../../src/types/base'
import type { TokenUsage, AgentRuntimeStatus, SerializedErrorInfo } from '../shared/types'
import type { TimeFilter } from '@openchatlab/shared-types'

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

/**
 * ChatApi — 导入、迁移、Demo（数据查询/分析/成员/SQL 已迁移到 HTTP）
 */
interface ChatApi {
  selectFile: () => Promise<{ filePath?: string; format?: string; error?: string } | null>
  detectFormat: (filePath: string) => Promise<{ id: string; name: string; platform: string; multiChat: boolean } | null>
  import: (filePath: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>
  importDirectory: (dirPath: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>
  importWithOptions: (
    filePath: string,
    formatOptions: Record<string, unknown>
  ) => Promise<{ success: boolean; sessionId?: string; error?: string }>
  scanMultiChatFile: (filePath: string) => Promise<{
    success: boolean
    chats: Array<{ index: number; name: string; type: string; id: number; messageCount: number }>
    error?: string
  }>
  checkMigration: () => Promise<MigrationCheckResult>
  runMigration: () => Promise<{ success: boolean; error?: string }>
  getSupportedFormats: () => Promise<Array<{ id: string; name: string; platform: string; extensions: string[] }>>
  onImportProgress: (callback: (progress: ImportProgress) => void) => () => void
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
  ) => Promise<{ success: boolean; newMessageCount: number; error?: string }>
  importDemo: (locale: string) => Promise<{
    success: boolean
    groupSessionId?: string
    privateSessionIds?: string[]
    error?: string
  }>
  onDemoProgress: (
    callback: (progress: { stage: string; current: number; total: number; message?: string }) => void
  ) => () => void
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

/**
 * AiApi — IPC-only subset
 *
 * Conversation/message CRUD and debug queries have been migrated to HTTP
 * shared routes (FetchAIAdapter via Internal Server). Only features that
 * require worker, native shell, or tool registry remain on IPC.
 */
interface AiApi {
  // Message filtering / export (worker-dependent)
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
  onExportProgress: (callback: (progress: ExportProgress) => void) => () => void
  // Native shell
  showAiLogFile: () => Promise<{ success: boolean; path?: string; error?: string }>
  // Desensitize rules (node-runtime)
  getDefaultDesensitizeRules: (locale: string) => Promise<DesensitizeRule[]>
  mergeDesensitizeRules: (existingRules: DesensitizeRule[], locale: string) => Promise<DesensitizeRule[]>
  // Tool testing (tool registry on main process)
  getToolCatalog: () => Promise<ToolCatalogEntry[]>
  executeTool: (
    testId: string,
    toolName: string,
    params: Record<string, unknown>,
    sessionId: string
  ) => Promise<ToolExecuteResult>
  cancelToolTest: (testId: string) => Promise<{ success: boolean }>
  // Context estimation (needs conversationManager)
  estimateContextTokens: (
    conversationId: string
  ) => Promise<{ success: boolean; tokens: number; messageCount?: number; error?: string }>
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
  contextWindow?: number
  capabilities: ModelCapability[]
  recommendedFor: ModelRecommendedFor[]
  status: ModelStatus
  builtin: boolean
  editable: boolean
}

interface LLMChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface LLMChatOptions {
  temperature?: number
  maxTokens?: number
}

/**
 * LLM CRUD (config, provider, model, validate, etc.) has been migrated to
 * HTTP service layer via FetchLLMAdapter. Streaming chat uses shared SSE route.
 * Only non-streaming chat remains on IPC.
 */
interface LlmApi {
  chat: (
    messages: LLMChatMessage[],
    options?: LLMChatOptions
  ) => Promise<{ success: boolean; content?: string; error?: string }>
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

// Agent streaming migrated to shared SSE route (useAgentStreamService)
// Assistant CRUD migrated to HTTP service layer (FetchAssistantAdapter)
// Skill CRUD migrated to HTTP service layer (FetchSkillAdapter)

/**
 * CacheApi — IPC-only subset
 *
 * Most cache operations have been migrated to HTTP shared routes
 * (FetchCacheAdapter). Only selectDataDir and setDataDir remain on IPC
 * because they require native Electron dialogs and app restart.
 */
interface CacheApi {
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
  removeImportSession: (sourceId: string, sessionId: string, deleteData?: boolean) => Promise<boolean>
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
  generateIncremental: (sessionId: string, gapThreshold?: number) => Promise<number>
  hasIndex: (sessionId: string) => Promise<boolean>
  getStats: (sessionId: string) => Promise<SessionStats>
  getAllIndexStats: () => Promise<Array<{ sessionId: string; hasIndex: boolean; sessionCount: number }>>
  clear: (sessionId: string) => Promise<boolean>
  updateGapThreshold: (sessionId: string, gapThreshold: number | null) => Promise<boolean>
  getSessions: (sessionId: string) => Promise<ChatSessionItem[]>
  /** 生成单个会话摘要 */
  generateSummary: (
    dbSessionId: string,
    chatSessionId: number,
    locale?: string,
    forceRegenerate?: boolean,
    strategy?: 'brief' | 'standard'
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
    aiApi: AiApi
    llmApi: LlmApi
    cacheApi: CacheApi
    networkApi: NetworkApi
    sessionApi: SessionApi
    apiServerApi: ApiServerApi
    internalApi: InternalApi
  }
}

interface InternalEndpoint {
  baseUrl: string
  token: string
}

interface InternalApi {
  getEndpoint: () => Promise<InternalEndpoint | null>
}

export {
  ChatApi,
  Api,
  AiApi,
  LlmApi,
  ProviderDefinition,
  ProviderKind,
  ModelDefinition,
  ModelCapability,
  ModelStatus,
  ModelRecommendedFor,
  AgentApi,
  CacheApi,
  NetworkApi,
  ProxyConfig,
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
  FilterMessage,
  ContextBlock,
  FilterResult,
  ApiServerApi,
  ApiServerConfig,
  ApiServerStatus,
  DataSource,
  ImportSession,
  InternalApi,
  InternalEndpoint,
}
