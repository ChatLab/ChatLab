import type { LlmStreamChunk, AgentStreamChunk, AgentStreamResult, AgentStreamParams } from './types'
import { fetchSSE } from '../utils/sse'

/**
 * LLM stream service — uses fetchSSE to consume the shared
 * `/_web/ai/llm/chat-stream` SSE endpoint.
 */
export function useLlmStreamService() {
  return {
    async chatStream(
      messages: Array<{ role: string; content: string }>,
      options?: { temperature?: number; maxTokens?: number },
      onChunk?: (chunk: LlmStreamChunk) => void
    ): Promise<{ success: boolean; error?: string }> {
      try {
        await fetchSSE({
          url: '/_web/ai/llm/chat-stream',
          body: { messages, options },
          onEvent: ({ data }) => {
            if (!onChunk) return
            try {
              const parsed = JSON.parse(data) as LlmStreamChunk
              onChunk(parsed)
            } catch {
              // skip malformed JSON
            }
          },
        })
        return { success: true }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        return { success: false, error: msg }
      }
    },
  }
}

/**
 * Agent stream service — uses fetchSSE to consume the shared
 * `/_web/ai/agent/stream` SSE endpoint.
 */

const requestIdMap = new Map<string, { serverId: string; abortController: AbortController }>()

export function useAgentStreamService() {
  return {
    runStream(
      params: AgentStreamParams,
      onChunk?: (chunk: AgentStreamChunk) => void
    ): { requestId: string; promise: Promise<AgentStreamResult> } {
      const abortController = new AbortController()
      const localRequestId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      requestIdMap.set(localRequestId, { serverId: '', abortController })

      const promise = new Promise<AgentStreamResult>((resolve) => {
        let resultContent = ''
        const toolsUsed: string[] = []
        let toolRounds = 0
        let lastUsage: AgentStreamResult['result'] extends { totalUsage?: infer U } ? U : undefined
        let hasError = false
        let lastError: AgentStreamResult['error']

        fetchSSE({
          url: '/_web/ai/agent/stream',
          body: params,
          signal: abortController.signal,
          onEvent: ({ event, data }) => {
            try {
              const parsed = JSON.parse(data)

              if (event === 'meta') {
                const entry = requestIdMap.get(localRequestId)
                if (entry) entry.serverId = parsed.requestId ?? ''
                return
              }

              const chunk = parsed as AgentStreamChunk
              onChunk?.(chunk)

              switch (chunk.type) {
                case 'content':
                  if (chunk.content) resultContent += chunk.content
                  break
                case 'tool_start':
                  if (chunk.toolName && !toolsUsed.includes(chunk.toolName)) {
                    toolsUsed.push(chunk.toolName)
                  }
                  break
                case 'status':
                  if (chunk.status) toolRounds = chunk.status.round
                  break
                case 'done':
                  if (chunk.usage) lastUsage = chunk.usage
                  break
                case 'error':
                  hasError = true
                  lastError = chunk.error as AgentStreamResult['error']
                  break
              }
            } catch {
              // skip malformed JSON
            }
          },
        })
          .then(() => {
            requestIdMap.delete(localRequestId)
            resolve({
              success: !hasError,
              result: {
                content: resultContent,
                toolsUsed,
                toolRounds,
                totalUsage: lastUsage,
              },
              ...(hasError && lastError ? { error: lastError } : {}),
            })
          })
          .catch((error) => {
            requestIdMap.delete(localRequestId)
            if (abortController.signal.aborted) {
              resolve({
                success: false,
                result: { content: resultContent, toolsUsed, toolRounds, aborted: true },
              })
            } else {
              resolve({
                success: false,
                error: { name: 'FetchError', message: error.message ?? String(error), stack: null },
              })
            }
          })
      })

      return { requestId: localRequestId, promise }
    },

    async abort(requestId: string): Promise<{ success: boolean; error?: string }> {
      const entry = requestIdMap.get(requestId)
      if (!entry) return { success: false, error: 'Request not found' }

      entry.abortController.abort()

      if (entry.serverId) {
        try {
          const { post } = await import('../utils/http')
          await post<{ success: boolean }>('/ai/agent/abort', { requestId: entry.serverId })
        } catch {
          // server-side abort is best-effort; client already aborted the fetch
        }
      }

      requestIdMap.delete(requestId)
      return { success: true }
    },
  }
}
