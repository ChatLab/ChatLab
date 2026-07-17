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
  /** 去重过滤的消息数 */
  duplicateCount: number
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

interface ChatImportResult {
  success: boolean
  sessionId?: string
  error?: string
  importMode?: 'created' | 'incremental'
  matchedBy?: 'source-session-id' | 'stable-id' | 'trailing-messages'
  createReason?: 'no-match' | 'ambiguous'
  newMessageCount?: number
  duplicateCount?: number
  diagnostics?: ImportDiagnostics
}

/**
 * ChatApi — 导入、迁移、Demo（数据查询/分析/成员/SQL 已迁移到 HTTP）
 */
interface ChatApi {
  selectFile: () => Promise<{ filePath?: string; format?: string; error?: string } | null>
  detectFormat: (filePath: string) => Promise<{ id: string; name: string; platform: string; multiChat: boolean } | null>
  import: (filePath: string) => Promise<ChatImportResult>
  importDirectory: (dirPath: string) => Promise<ChatImportResult>
  importWithOptions: (filePath: string, formatOptions: Record<string, unknown>) => Promise<ChatImportResult>
  scanMultiChatFile: (filePath: string) => Promise<{
    success: boolean
    chats: Array<{ index: number; name: string; type: string; id: number; messageCount: number }>
    error?: string
  }>
  prepareImportSource: (filePath: string) => Promise<{
    success: boolean
    source?: {
      sourceId: string
      formatId: string
      platform: string
      chats: Array<{
        chatId: string
        name: string
        type: 'private' | 'group'
        messageCount: number
        memberCount: number
      }>
      expiresAt: number
    }
    error?: string
  }>
  importPreparedChat: (sourceId: string, chatId: string) => Promise<ChatImportResult>
  releaseImportSource: (sourceId: string) => Promise<{ success: boolean }>
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
  setTitleBarOverlayColor: (color: string) => void
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
    trackDailyActive: (locale: string) => Promise<void>
    relaunch: () => Promise<void>
    getOpenAtLogin: () => Promise<boolean>
    setOpenAtLogin: (enabled: boolean) => Promise<{ success: boolean; error?: string }>
  }
}

/**
 * AiApi — IPC-only subset
 *
 * Most AI functionality has been migrated to HTTP shared routes.
 * Only export (fs write + progress push) remains on IPC.
 */
interface AiApi {
  exportFilterResultToFile: (params: {
    sessionId: string
    sessionName: string
    outputDir: string
    format?: 'txt' | 'json' | 'markdown'
    timeFilter?: TimeFilter
  }) => Promise<{ success: boolean; filePath?: string; error?: string }>
  onExportProgress: (callback: (progress: ExportProgress) => void) => () => void
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

// LLM API has been fully migrated to shared HTTP/SSE routes.
// LlmApi interface removed — no IPC consumers remain.

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
  group?: string
}

/** 聊天记录预处理配置 */
interface PreprocessConfig {
  dataCleaning: boolean
  mergeConsecutive: boolean
  mergeWindowSeconds?: number
  blacklistKeywords: string[]
  denoise: boolean
  desensitize: boolean
  desensitizeRulesSchemaVersion?: number
  desensitizeBuiltinRuleOverrides?: Record<string, boolean>
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
  ) => Promise<{ success: boolean; error?: string; from?: string; to?: string; requiresRelaunch?: boolean }>
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

interface ApiServerApi {
  getConfig: () => Promise<ApiServerConfig>
  getStatus: () => Promise<ApiServerStatus>
  setEnabled: (enabled: boolean) => Promise<ApiServerStatus>
  setPort: (port: number) => Promise<ApiServerStatus>
  regenerateToken: () => Promise<ApiServerConfig>
  onStartupError: (callback: (data: { error: string }) => void) => () => void
  onImportCompleted: (callback: () => void) => () => void
}

// Session index API has been migrated to shared HTTP routes (FetchSessionIndexAdapter).

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
    chatApi: ChatApi
    aiApi: AiApi
    cacheApi: CacheApi
    networkApi: NetworkApi
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

// ==================== 应用锁安全 API 类型 ====================

interface LockConfig {
  enabled: boolean
  unlockMode: 'password' | 'windows-hello'
  idleTimeoutMinutes: number
  lockOnBlur: boolean
  lockOnStartup: boolean
  hasPassword: boolean
  windowsHelloAvailable: boolean
}

interface WindowsHelloAvailability {
  available: boolean
  tipText: string
}

interface UnlockResult {
  success: boolean
  needsSetup?: boolean
  wrongPassword?: boolean
  cooldown?: boolean
  cooldownRemaining?: number
  remainingRetries?: number
  windowsHelloUnavailable?: boolean
  cancelled?: boolean
  error?: string
}

interface PasswordChangeResult {
  success: boolean
  error?: string
  strength?: 'weak' | 'medium' | 'strong'
}

interface SecurityApi {
  getConfig: () => Promise<LockConfig>
  getState: () => Promise<{ state: 'unlocked' | 'locked' | 'recovery-locked' | 'configuring' }>
  checkWindowsHello: () => Promise<WindowsHelloAvailability>
  verifyHello: (message: string) => Promise<{ success: boolean; verified: boolean; cancelled: boolean; notAvailable: boolean; error?: string }>
  verifyAppPassword: (rawPassword: string) => Promise<{ success: boolean; cooldown?: boolean; cooldownRemaining?: number; remainingRetries?: number; error?: string }>
  reEnableLock: (oldPassword: string) => Promise<{ success: boolean; error?: string }>
  recoveryReset: () => Promise<{ success: boolean; error?: string }>
  lock: () => Promise<{ success: boolean; error?: string }>
  unlock: (credentials?: { password?: string; useWindowsHello?: boolean }) => Promise<UnlockResult>
  setPassword: (newPassword: string, enableLock?: boolean) => Promise<PasswordChangeResult>
  changePassword: (oldPassword: string, newPassword: string) => Promise<PasswordChangeResult>
  resetPassword: () => Promise<{ success: boolean; error?: string }>
  updateConfig: (
    updates: Partial<{
      enabled: boolean
      unlockMode: 'password' | 'windows-hello'
      idleTimeoutMinutes: number
      lockOnBlur: boolean
      lockOnStartup: boolean
    }>
  ) => Promise<{ success: boolean; config?: LockConfig; error?: string }>
  reportActivity: () => void
  onLockStateChanged: (callback: (data: { locked: boolean }) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
    chatApi: ChatApi
    aiApi: AiApi
    cacheApi: CacheApi
    networkApi: NetworkApi
    apiServerApi: ApiServerApi
    internalApi: InternalApi
    securityApi: SecurityApi
  }
}

export {
  ChatApi,
  Api,
  AiApi,
  ProviderDefinition,
  ProviderKind,
  ModelDefinition,
  ModelCapability,
  ModelStatus,
  ModelRecommendedFor,
  CacheApi,
  NetworkApi,
  ProxyConfig,
  AgentRuntimeStatus,
  SerializedErrorInfo,
  DesensitizeRule,
  PreprocessConfig,
  TokenUsage,
  ApiServerApi,
  ApiServerConfig,
  ApiServerStatus,
  InternalApi,
  InternalEndpoint,
}
