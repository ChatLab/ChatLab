import type { AgentStreamEvent, FinishReason, RuntimeConversation, RuntimeMessage } from '@openchatlab/ai-runtime'

export type WebAIProvider = 'deepseek' | 'openai-compatible'

export interface WebModelConfig {
  provider: WebAIProvider
  baseURL?: string
  model: string
  updatedAt: number
}

export interface SaveWebModelConfigInput extends Omit<WebModelConfig, 'updatedAt'> {
  apiKey: string
}

export interface WebAIConnectionTestResult {
  ok: boolean
  latencyMs?: number
  error?: WebAIRuntimeErrorData
}

export interface WebAIRuntimeErrorData {
  code: 'NOT_CONFIGURED' | 'AUTH' | 'RATE_LIMIT' | 'MODEL_NOT_FOUND' | 'TIMEOUT' | 'NETWORK_OR_CORS' | 'UNKNOWN'
  message: string
  retryable: boolean
  status?: number
}

export interface WebAIRunInput {
  sessionId: string
  conversationId: string
  locale: string
  userMessage: string
  onEvent: (event: AgentStreamEvent) => void
}

export interface WebAIRunResult {
  userMessage: RuntimeMessage
  assistantMessage: RuntimeMessage
  finishReason: FinishReason
}

export interface WebAIRuntimeCapabilities {
  defaultAssistant: true
  customAssistants: false
  skills: false
  rag: false
  localModels: false
  multipleModelSlots: false
  historyEditing: false
  regenerateLast: true
  retryLast: true
  persistentApiKey: true
}

export const WEB_AI_RUNTIME_CAPABILITIES: WebAIRuntimeCapabilities = {
  defaultAssistant: true,
  customAssistants: false,
  skills: false,
  rag: false,
  localModels: false,
  multipleModelSlots: false,
  historyEditing: false,
  regenerateLast: true,
  retryLast: true,
  persistentApiKey: true,
}

export type { AgentStreamEvent, RuntimeConversation, RuntimeMessage }
