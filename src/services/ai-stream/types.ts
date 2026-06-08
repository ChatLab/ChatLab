import type { PlanContentBlock } from '@/services/ai/planBlocks'

export interface LlmStreamChunk {
  content: string
  isFinished: boolean
  finishReason?: 'stop' | 'length' | 'error'
  error?: string
  thinking?: string
  thinkingDone?: boolean
}

export interface AgentStreamChunk {
  type: 'content' | 'think' | 'tool_start' | 'tool_result' | 'status' | 'compression_done' | 'plan' | 'done' | 'error'
  content?: string
  thinkTag?: string
  thinkDurationMs?: number
  toolName?: string
  toolParams?: Record<string, unknown>
  toolResult?: unknown
  error?: unknown
  isFinished?: boolean
  usage?: TokenUsage
  status?: AgentRuntimeStatus
  plan?: PlanContentBlock
  compressionResult?: {
    summaryContent: string
    tokensBefore: number
    tokensAfter: number
    timestamp: number
  }
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface AgentRuntimeStatus {
  phase: 'compressing' | 'preparing' | 'thinking' | 'tool_running' | 'responding' | 'completed' | 'aborted' | 'error'
  round: number
  toolsUsed: number
  currentTool?: string
  contextTokens: number
  totalUsage: TokenUsage
  updatedAt: number
}

export interface SerializedErrorInfo {
  name: string | null
  message: string | null
  stack?: string | null
  friendlyMessage?: string | null
  url?: string | null
}

export interface AgentStreamResult {
  success: boolean
  result?: {
    content: string
    toolsUsed: string[]
    toolRounds: number
    totalUsage?: TokenUsage
    aborted?: boolean
  }
  error?: SerializedErrorInfo | Record<string, unknown>
}

export interface CompressionConfig {
  enabled: boolean
  tokenThresholdPercent: number
  bufferSizePercent: number
  maxToolResultPercent?: number
}

export interface AgentStreamParams {
  userMessage: string
  sessionId: string
  aiChatId?: string
  historyLeafMessageId?: string | null
  chatType?: 'group' | 'private'
  locale?: string
  assistantId?: string
  skillId?: string | null
  enableAutoSkill?: boolean
  compressionConfig?: CompressionConfig
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
