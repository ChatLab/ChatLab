/**
 * HttpRouteContext — shared dependency injection interface for route handlers.
 *
 * CLI Server and Electron Internal Server each construct their own context
 * and pass it to registerSharedRoutes(). Route handlers only depend on this
 * interface, never on CLI or Electron specific modules.
 */

import type { PathProvider } from '@openchatlab/core'
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
} from '@openchatlab/node-runtime'

export interface HttpRouteContext {
  dbManager: DatabaseManager
  sessionAdapter: SessionRuntimeAdapter
  pathProvider: PathProvider

  getVersion: () => string

  /** Native binding path for better-sqlite3 (CLI needs it, Electron does not) */
  nativeBinding?: string

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
