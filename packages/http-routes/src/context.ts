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
  SessionRuntimeAdapter,
  PreferencesManager,
  AIConversationManager,
  AssistantManager,
  SkillManagerCore,
  LLMConfigStore,
  CustomProviderStore,
  CustomModelStore,
  MergeSessionCache,
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
  conversationManager?: AIConversationManager
  assistantManager?: AssistantManager
  skillManagerCore?: SkillManagerCore
  llmConfigStore?: LLMConfigStore
  customProviderStore?: CustomProviderStore
  customModelStore?: CustomModelStore
}
