import type { LanguageModel } from 'ai'

export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

export type RuntimeMessageRole = 'user' | 'assistant' | 'summary'

export interface RuntimeMessage {
  id: string
  conversationId: string
  role: RuntimeMessageRole
  content: string
  createdAt: number
  blocks?: RuntimeContentBlock[]
  usage?: TokenUsage
}

export type RuntimeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; callId: string; name: string; input: unknown; result?: RuntimeToolResult; isError?: boolean }
  | { type: 'chart'; payload: unknown }
  | { type: 'evidence'; payload: unknown }

export interface RuntimeConversation {
  id: string
  sessionId: string
  title: string | null
  createdAt: number
  updatedAt: number
}

export interface AppendRuntimeMessageInput {
  id?: string
  conversationId: string
  role: RuntimeMessageRole
  content: string
  createdAt?: number
  blocks?: RuntimeContentBlock[]
  usage?: TokenUsage
}

export interface ConversationRepository {
  getConversation(id: string): Promise<RuntimeConversation | null>
  getMessages(conversationId: string): Promise<RuntimeMessage[]>
  appendMessage(input: AppendRuntimeMessageInput): Promise<RuntimeMessage>
  updateMessage(id: string, patch: Pick<RuntimeMessage, 'content' | 'blocks' | 'usage'>): Promise<void>
  replaceSummary(conversationId: string, input: { content: string; boundaryMessageId: string }): Promise<RuntimeMessage>
}

export interface RuntimeToolResult {
  content: string
  data?: unknown
  chart?: unknown
  evidence?: unknown
  truncated?: boolean
}

export interface RuntimeToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
    additionalProperties?: boolean
  }
}

export interface ToolExecutionContext {
  sessionId: string
  conversationId: string
}

export interface ToolExecutor {
  listTools(): RuntimeToolDefinition[]
  execute(name: string, input: unknown, context: ToolExecutionContext, signal: AbortSignal): Promise<RuntimeToolResult>
}

export interface RuntimeModel {
  model: LanguageModel
  contextWindow: number
}

export type FinishReason = 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'aborted' | 'unknown'

export type AgentStreamEvent =
  | { type: 'start'; requestId: string; messageId: string }
  | { type: 'text-delta'; delta: string }
  | { type: 'reasoning-delta'; delta: string }
  | { type: 'tool-start'; callId: string; name: string; input: unknown }
  | { type: 'tool-result'; callId: string; name: string; result: RuntimeToolResult; isError: boolean }
  | { type: 'chart'; payload: unknown }
  | { type: 'evidence'; payload: unknown }
  | { type: 'compression-start' }
  | { type: 'compression-done'; summaryMessageId: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'finish'; reason: FinishReason }
  | { type: 'error'; error: RuntimeErrorData }

export interface RuntimeErrorData {
  code: 'ABORTED' | 'MODEL_ERROR' | 'TOOL_ERROR' | 'CONTEXT_TOO_LARGE' | 'PERSISTENCE_ERROR' | 'UNKNOWN'
  message: string
  retryable: boolean
}

export interface RunAgentInput {
  requestId?: string
  messageId?: string
  conversationId: string
  sessionId: string
  systemPrompt: string
  userMessage: string
  model: RuntimeModel
  repository: ConversationRepository
  tools: ToolExecutor
  signal: AbortSignal
  maxToolSteps?: number
  maxOutputTokens?: number
  compression?: Partial<CompressionPolicy>
  onEvent: (event: AgentStreamEvent) => void
}

export interface RunAgentResult {
  message: RuntimeMessage
  usage: TokenUsage
  finishReason: FinishReason
  toolsUsed: string[]
  compressed: boolean
}

export interface CompressionPolicy {
  thresholdRatio: number
  recentBufferRatio: number
  maxSummaryTokens: number
  minMessages: number
  maxToolResultCharacters: number
}
