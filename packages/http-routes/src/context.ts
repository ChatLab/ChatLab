/**
 * HttpRouteContext — shared dependency injection interface for route handlers.
 *
 * CLI Server and Electron Internal Server each construct their own context
 * and pass it to registerSharedRoutes(). Route handlers only depend on this
 * interface, never on CLI or Electron specific modules.
 */

import type { PathProvider } from '@openchatlab/core'
import type { ChartAutoMode } from '@openchatlab/shared-types'
import type { AuthProfile } from '@openchatlab/config'
import type { AnalyticsService } from '@openchatlab/node-runtime'
import type {
  DatabaseManager,
  DataDirSwitchResult,
  PendingDataDirMigration,
  SessionRuntimeAdapter,
  PreferencesManager,
  AIChatManager,
  AssistantManager,
  SkillManagerCore,
  LLMConfigStore,
  CustomProviderStore,
  CustomModelStore,
  MergeSessionCache,
  AgentStreamChunk,
  SemanticIndexRuntime,
  ContactsService,
  PeopleRelationshipsService,
} from '@openchatlab/node-runtime'
import type { RuntimeIdentity } from '@openchatlab/node-runtime'

export interface HttpRouteContext {
  dbManager: DatabaseManager
  sessionAdapter: SessionRuntimeAdapter
  pathProvider: PathProvider

  getVersion: () => string
  runtimeIdentity?: RuntimeIdentity

  /** Native binding path for better-sqlite3 (CLI needs it, Electron does not) */
  nativeBinding?: string
  contactsService?: ContactsService
  peopleRelationshipsService?: PeopleRelationshipsService

  preferencesManager?: PreferencesManager

  /** Merge subsystem — optional, merge routes gracefully skip when absent */
  mergeSessionCache?: MergeSessionCache
  /**
   * Platform-specific import function for merge "andImport" flow.
   * CLI and Electron each provide their own implementation.
   */
  streamImport?: (dbManager: DatabaseManager, filePath: string) => Promise<{ sessionId: string }>

  /** AI subsystem — optional, routes gracefully skip when absent */
  aiDataDir?: string
  aiChatManager?: AIChatManager
  assistantManager?: AssistantManager
  skillManagerCore?: SkillManagerCore
  llmConfigStore?: LLMConfigStore
  customProviderStore?: CustomProviderStore
  customModelStore?: CustomModelStore

  /** 语义索引共享 service — 可选，路由在缺失时优雅跳过 */
  semanticIndexService?: SemanticIndexRuntime

  /**
   * auth-profiles 读写注入 — 仅语义索引「向量库不可用」降级路径使用（其余路径走 service 内部注入）。
   * 缺省时 helper 回退到 @openchatlab/config 的真实读写（生产行为不变）；测试可注入内存实现，
   * 避免降级配置写入真实 ~/.chatlab。
   */
  resolveApiKey?: (provider: string, authProfile?: string) => string
  writeAuthProfile?: (name: string, profile: AuthProfile) => void

  /** Analytics tracking service — optional, telemetry routes silently skip when absent */
  analyticsService?: AnalyticsService

  /** Cache/storage — platform-specific (optional) */
  openDirectory?: (dirPath: string) => Promise<void>
  showInFolder?: (filePath: string) => Promise<void>
  downloadsDir?: string
  defaultUserDataDir?: string
  isCustomDataDir?: boolean
  canSetDataDir?: boolean
  getPendingDataDirMigration?: () => PendingDataDirMigration | null
  setDataDir?: (dirPath: string | null, migrate?: boolean) => Promise<DataDirSwitchResult> | DataDirSwitchResult

  /** Agent streaming — platform-specific execution (optional) */
  runAgentStream?: (
    params: AgentStreamRequest,
    onEvent: (chunk: AgentStreamChunk) => void,
    abortSignal: AbortSignal
  ) => Promise<void>

  /** AI tool debug execution - platform-specific so Electron can keep DB work in its worker. */
  executeAiTool?: (params: AiToolExecuteRequest) => Promise<AiToolExecuteResult>
}

export interface AiToolExecuteRequest {
  testId: string
  toolName: string
  params: Record<string, unknown>
  sessionId: string
  abortSignal: AbortSignal
}

export interface AiToolExecuteResult {
  success: boolean
  elapsed?: number
  content?: Array<{ type: 'text'; text: string }>
  details?: unknown
  truncated?: boolean
  error?: string
}

export interface AgentStreamRequest {
  userMessage: string
  aiChatId: string
  historyLeafMessageId?: string | null
  sessionId: string
  chatType?: 'group' | 'private'
  locale?: string
  assistantId?: string
  skillId?: string | null
  enableAutoSkill?: boolean
  chartAutoMode?: ChartAutoMode
  compressionConfig?: {
    enabled: boolean
    tokenThresholdPercent?: number
    bufferSizePercent?: number
    maxToolResultPercent?: number
  }
  ownerInfo?: { platformId: string; displayName: string }
  mentionedMembers?: Array<{
    memberId: number
    platformId: string
    displayName: string
    aliases: string[]
    mentionText: string
  }>
  thinkingLevel?: string
  timeFilter?: { startTs: number; endTs: number }
  maxMessagesLimit?: number
  preprocessConfig?: Record<string, unknown>
}
