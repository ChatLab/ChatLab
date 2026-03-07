/**
 * LLM configuration & chat API client — replaces window.llmApi
 *
 * Maps preload IPC calls to HTTP endpoints under /api/llm.
 * Streaming chat uses SSE via POST /api/llm/chat-stream (to be added server-side).
 */

import { get, post, put, del, postSSE } from './client'

// ─────────────────────────── types ───────────────────────────

export interface LLMProvider {
  id: string
  name: string
  description: string
  defaultBaseUrl: string
  models: Array<{ id: string; name: string; description?: string }>
}

export interface AIServiceConfigDisplay {
  id: string
  name: string
  provider: string
  apiKey: string
  apiKeySet: boolean
  model?: string
  baseUrl?: string
  maxTokens?: number
  disableThinking?: boolean
  isReasoningModel?: boolean
  createdAt: number
  updatedAt: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  temperature?: number
  maxTokens?: number
}

export interface ChatStreamChunk {
  content: string
  isFinished: boolean
  finishReason?: 'stop' | 'length' | 'error'
}

// ─────────────────────────── llmApi ───────────────────────────

export const llmApi = {
  getProviders: () => get<LLMProvider[]>('/llm/providers'),

  // ── Multi-config management ──

  getAllConfigs: () =>
    get<{ configs: AIServiceConfigDisplay[]; activeConfigId: string | null }>('/llm/configs').then((r) => r.configs),

  getActiveConfigId: () =>
    get<{ configs: AIServiceConfigDisplay[]; activeConfigId: string | null }>('/llm/configs').then(
      (r) => r.activeConfigId,
    ),

  addConfig: (config: {
    name: string
    provider: string
    apiKey: string
    model?: string
    baseUrl?: string
    maxTokens?: number
    disableThinking?: boolean
    isReasoningModel?: boolean
  }) => post<AIServiceConfigDisplay>('/llm/configs', config).then((c) => ({ success: true, config: c })).catch((e) => ({ success: false, error: String(e) })) as Promise<{ success: boolean; config?: AIServiceConfigDisplay; error?: string }>,

  updateConfig: (
    id: string,
    updates: {
      name?: string
      provider?: string
      apiKey?: string
      model?: string
      baseUrl?: string
      maxTokens?: number
      disableThinking?: boolean
      isReasoningModel?: boolean
    },
  ) => put<{ success: boolean; error?: string }>(`/llm/configs/${id}`, updates),

  deleteConfig: (id?: string) =>
    del<{ success: boolean; error?: string }>(`/llm/configs/${id ?? 'active'}`),

  setActiveConfig: (id: string) =>
    put<{ success: boolean; error?: string }>(`/llm/configs/${id}/activate`),

  validateApiKey: (provider: string, apiKey: string, baseUrl?: string, model?: string) =>
    post<{ success: boolean; error?: string }>('/llm/validate', { provider, apiKey, baseUrl, model }).then(
      (r) => r.success,
    ) as unknown as Promise<boolean>,

  hasConfig: () =>
    get<{ hasConfig: boolean }>('/llm/has-config').then((r) => r.hasConfig),

  // ── Chat ──

  chat: (messages: ChatMessage[], options?: ChatOptions) =>
    post<{ success: boolean; content?: string; error?: string }>('/llm/chat', { messages, options }),

  /**
   * Streaming chat via SSE.
   *
   * Server responds with `text/event-stream`; each `data:` line is a ChatStreamChunk.
   */
  chatStream: async (
    messages: ChatMessage[],
    options?: ChatOptions,
    onChunk?: (chunk: ChatStreamChunk) => void,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      await postSSE<ChatStreamChunk>('/llm/chat-stream', { messages, options }, {
        onChunk: (chunk) => {
          if (onChunk) onChunk(chunk)
        },
      })
      return { success: true }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      if (onChunk) {
        onChunk({ content: '', isFinished: true, finishReason: 'error' })
      }
      return { success: false, error: errMsg }
    }
  },
}
