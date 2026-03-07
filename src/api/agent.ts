/**
 * Agent API client — replaces window.agentApi
 *
 * Maps preload IPC calls to HTTP endpoints under /api/agent.
 * Agent streaming uses SSE via POST /api/agent/run.
 */

import { post, postSSE } from './client'

// ─────────────────────────── types ───────────────────────────

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface AgentRuntimeStatus {
  phase: 'preparing' | 'thinking' | 'tool_running' | 'responding' | 'completed' | 'aborted' | 'error'
  round: number
  toolsUsed: number
  currentTool?: string
  contextTokens: number
  totalUsage: TokenUsage
  updatedAt: number
}

export interface AgentStreamChunk {
  type: 'content' | 'think' | 'tool_start' | 'tool_result' | 'status' | 'done' | 'error' | 'meta'
  content?: string
  thinkTag?: string
  thinkDurationMs?: number
  toolName?: string
  toolParams?: Record<string, unknown>
  toolResult?: unknown
  status?: AgentRuntimeStatus
  error?: string
  isFinished?: boolean
  usage?: TokenUsage
  requestId?: string
}

export interface AgentResult {
  content: string
  toolsUsed: string[]
  toolRounds: number
  totalUsage?: TokenUsage
}

export interface PromptConfig {
  roleDefinition: string
  responseRules: string
}

export interface PreprocessConfig {
  dataCleaning: boolean
  mergeConsecutive: boolean
  mergeWindowSeconds?: number
  blacklistKeywords: string[]
  denoise: boolean
  desensitize: boolean
  desensitizeRules: Array<{
    id: string
    label: string
    pattern: string
    replacement: string
    enabled: boolean
    builtin: boolean
    locales: string[]
  }>
  anonymizeNames: boolean
}

export interface ToolContext {
  sessionId: string
  conversationId?: string
  timeFilter?: { startTs: number; endTs: number }
  maxMessagesLimit?: number
  ownerInfo?: { platformId: string; displayName: string }
  locale?: string
  preprocessConfig?: PreprocessConfig
}

// ─────────────────────────── agentApi ───────────────────────────

export const agentApi = {
  /**
   * Run agent with SSE streaming.
   *
   * Returns { requestId, promise } just like the Electron preload version.
   * The requestId can be used to abort via `agentApi.abort(requestId)`.
   */
  runStream: (
    userMessage: string,
    context: ToolContext,
    onChunk?: (chunk: AgentStreamChunk) => void,
    chatType?: 'group' | 'private',
    promptConfig?: PromptConfig,
    locale?: string,
    maxHistoryRounds?: number,
  ): { requestId: string; promise: Promise<{ success: boolean; result?: AgentResult; error?: string }> } => {
    // Generate a client-side requestId (same pattern as Electron preload)
    const requestId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    const abortController = new AbortController()

    // Store the controller so abort() can use it
    activeControllers.set(requestId, abortController)

    const promise = (async () => {
      let finalResult: AgentResult | undefined
      let finalError: string | undefined

      try {
        await postSSE<AgentStreamChunk>(
          '/agent/run',
          {
            message: userMessage,
            sessionId: context.sessionId,
            conversationId: context.conversationId,
            chatType: chatType ?? 'group',
            locale: locale ?? 'zh-CN',
            requestId,
            timeFilter: context.timeFilter,
            maxMessagesLimit: context.maxMessagesLimit,
            ownerInfo: context.ownerInfo,
            promptConfig,
            preprocessConfig: context.preprocessConfig,
            maxHistoryRounds,
          },
          {
            onChunk: (chunk) => {
              // The 'done' chunk carries the final result
              if (chunk.type === 'done') {
                finalResult = {
                  content: chunk.content ?? '',
                  toolsUsed: [],
                  toolRounds: 0,
                  totalUsage: chunk.usage,
                }
              }
              if (chunk.type === 'error') {
                finalError = chunk.error
              }
              if (onChunk) onChunk(chunk)
            },
            signal: abortController.signal,
          },
        )
      } catch (error) {
        if (abortController.signal.aborted) {
          return { success: false, error: 'Aborted' }
        }
        finalError = error instanceof Error ? error.message : String(error)
      } finally {
        activeControllers.delete(requestId)
      }

      if (finalError) {
        return { success: false, error: finalError }
      }
      return { success: true, result: finalResult }
    })()

    return { requestId, promise }
  },

  /**
   * Abort a running agent request.
   */
  abort: async (requestId: string): Promise<{ success: boolean; error?: string }> => {
    // Abort the local fetch first
    const controller = activeControllers.get(requestId)
    if (controller) {
      controller.abort()
      activeControllers.delete(requestId)
    }

    // Also tell the server to abort
    try {
      return await post<{ success: boolean; error?: string }>(`/agent/abort/${requestId}`)
    } catch {
      // If the server request fails (e.g., already completed), that's OK
      return { success: true }
    }
  },
}

// Track active abort controllers by requestId
const activeControllers = new Map<string, AbortController>()
