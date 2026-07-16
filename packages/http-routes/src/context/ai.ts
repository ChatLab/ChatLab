import type { AuthProfile } from '@openchatlab/config'
import type {
  AgentStreamChunk,
  AIChatManager,
  AssistantManager,
  CustomModelStore,
  CustomProviderStore,
  LLMConfigStore,
  SemanticIndexRuntime,
  SkillManagerCore,
} from '@openchatlab/node-runtime'
import type { ChartAutoMode } from '@openchatlab/shared-types'

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

/** Optional AI capabilities. Individual route groups gracefully skip unavailable features. */
export interface AiRouteContext {
  aiDataDir?: string
  aiChatManager?: AIChatManager
  assistantManager?: AssistantManager
  skillManagerCore?: SkillManagerCore
  llmConfigStore?: LLMConfigStore
  customProviderStore?: CustomProviderStore
  customModelStore?: CustomModelStore
  getCurrentAiLogPath?: () => string | null
  semanticIndexService?: SemanticIndexRuntime

  /** Optional auth-profile hooks used by the semantic-index fallback configuration routes. */
  resolveApiKey?: (provider: string, authProfile?: string) => string
  writeAuthProfile?: (name: string, profile: AuthProfile) => void

  runAgentStream?: (
    params: AgentStreamRequest,
    onEvent: (chunk: AgentStreamChunk) => void,
    abortSignal: AbortSignal
  ) => Promise<void>
  /** Platform-specific tool execution lets Electron keep database work in its worker. */
  executeAiTool?: (params: AiToolExecuteRequest) => Promise<AiToolExecuteResult>
}
