/**
 * AI conversations & message query API client — replaces window.aiApi
 *
 * Maps preload IPC calls to HTTP endpoints under /api/sessions/:id/messages
 * and /api/ai-conversations.
 */

import { get, post, put, del } from './client'
import type { ExportProgress } from '@/types/base'

// ─────────────────────────── types ───────────────────────────

export interface SearchMessageResult {
  id: number
  senderName: string
  senderPlatformId: string
  senderAliases: string[]
  senderAvatar: string | null
  content: string
  timestamp: number
  type: number
}

export interface AIConversation {
  id: string
  sessionId: string
  title: string | null
  createdAt: number
  updatedAt: number
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'tool'
      tool: {
        name: string
        displayName: string
        status: 'running' | 'done' | 'error'
        params?: Record<string, unknown>
      }
    }

export interface AIMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  dataKeywords?: string[]
  dataMessageCount?: number
  contentBlocks?: ContentBlock[]
}

export interface DesensitizeRule {
  id: string
  label: string
  pattern: string
  replacement: string
  enabled: boolean
  builtin: boolean
  locales: string[]
}

interface TimeFilter {
  startTs?: number
  endTs?: number
}

interface FilterMessage {
  id: number
  senderName: string
  senderPlatformId: string
  senderAliases: string[]
  senderAvatar: string | null
  content: string
  timestamp: number
  type: number
  replyToMessageId: string | null
  replyToContent: string | null
  replyToSenderName: string | null
  isHit: boolean
}

interface ContextBlock {
  startTs: number
  endTs: number
  messages: FilterMessage[]
  hitCount: number
}

interface FilterResultWithPagination {
  blocks: ContextBlock[]
  stats: {
    totalMessages: number
    hitMessages: number
    totalChars: number
  }
  pagination: {
    page: number
    pageSize: number
    totalBlocks: number
    totalHits: number
    hasMore: boolean
  }
}

// ─────────────────────────── aiApi ───────────────────────────

export const aiApi = {
  // ── Message search & browsing ──

  searchMessages: (
    sessionId: string,
    keywords: string[],
    filter?: TimeFilter,
    limit?: number,
    offset?: number,
    senderId?: number,
  ) =>
    post<{ messages: SearchMessageResult[]; total: number }>(`/sessions/${sessionId}/messages/search`, {
      keywords,
      filter,
      limit,
      offset,
      senderId,
    }),

  getMessageContext: (sessionId: string, messageIds: number | number[], contextSize?: number) =>
    get<SearchMessageResult[]>(`/sessions/${sessionId}/messages/context/${Array.isArray(messageIds) ? messageIds[0] : messageIds}`, {
      ...(Array.isArray(messageIds) ? { messageIds: JSON.stringify(messageIds) } : {}),
      ...(contextSize !== undefined ? { contextSize } : {}),
    }),

  getRecentMessages: (sessionId: string, filter?: TimeFilter, limit?: number) =>
    get<{ messages: SearchMessageResult[]; total: number }>(`/sessions/${sessionId}/messages/recent`, {
      ...(filter?.startTs !== undefined ? { startTs: filter.startTs } : {}),
      ...(filter?.endTs !== undefined ? { endTs: filter.endTs } : {}),
      ...(limit !== undefined ? { limit } : {}),
    }),

  getAllRecentMessages: (sessionId: string, filter?: TimeFilter, limit?: number) =>
    get<{ messages: SearchMessageResult[]; total: number }>(`/sessions/${sessionId}/messages/all-recent`, {
      ...(filter?.startTs !== undefined ? { startTs: filter.startTs } : {}),
      ...(filter?.endTs !== undefined ? { endTs: filter.endTs } : {}),
      ...(limit !== undefined ? { limit } : {}),
    }),

  getConversationBetween: (
    sessionId: string,
    memberId1: number,
    memberId2: number,
    filter?: TimeFilter,
    limit?: number,
  ) =>
    post<{ messages: SearchMessageResult[]; total: number; member1Name: string; member2Name: string }>(
      `/sessions/${sessionId}/messages/conversation-between`,
      { memberId1, memberId2, filter, limit },
    ),

  getMessagesBefore: (
    sessionId: string,
    beforeId: number,
    limit?: number,
    filter?: TimeFilter,
    senderId?: number,
    keywords?: string[],
  ) =>
    get<{ messages: SearchMessageResult[]; hasMore: boolean }>(`/sessions/${sessionId}/messages/before/${beforeId}`, {
      ...(limit !== undefined ? { limit } : {}),
      ...(filter?.startTs !== undefined ? { startTs: filter.startTs } : {}),
      ...(filter?.endTs !== undefined ? { endTs: filter.endTs } : {}),
      ...(senderId !== undefined ? { senderId } : {}),
      ...(keywords ? { keywords: JSON.stringify(keywords) } : {}),
    }),

  getMessagesAfter: (
    sessionId: string,
    afterId: number,
    limit?: number,
    filter?: TimeFilter,
    senderId?: number,
    keywords?: string[],
  ) =>
    get<{ messages: SearchMessageResult[]; hasMore: boolean }>(`/sessions/${sessionId}/messages/after/${afterId}`, {
      ...(limit !== undefined ? { limit } : {}),
      ...(filter?.startTs !== undefined ? { startTs: filter.startTs } : {}),
      ...(filter?.endTs !== undefined ? { endTs: filter.endTs } : {}),
      ...(senderId !== undefined ? { senderId } : {}),
      ...(keywords ? { keywords: JSON.stringify(keywords) } : {}),
    }),

  // ── Filter with context (paginated) ──

  filterMessagesWithContext: (
    sessionId: string,
    keywords?: string[],
    timeFilter?: TimeFilter,
    senderIds?: number[],
    contextSize?: number,
    page?: number,
    pageSize?: number,
  ) =>
    post<FilterResultWithPagination>(`/sessions/${sessionId}/messages/filter`, {
      keywords,
      timeFilter,
      senderIds,
      contextSize,
      page,
      pageSize,
    }),

  getMultipleSessionsMessages: (
    sessionId: string,
    chatSessionIds: number[],
    page?: number,
    pageSize?: number,
  ) =>
    post<FilterResultWithPagination>(`/sessions/${sessionId}/messages/multi-sessions`, {
      chatSessionIds,
      page,
      pageSize,
    }),

  // ── Export filter result ──

  exportFilterResultToFile: (params: {
    sessionId: string
    sessionName: string
    outputDir: string
    filterMode: 'condition' | 'session'
    keywords?: string[]
    timeFilter?: TimeFilter
    senderIds?: number[]
    contextSize?: number
    chatSessionIds?: number[]
  }) =>
    post<{ success: boolean; filePath?: string; error?: string }>(`/sessions/${params.sessionId}/messages/export`, params),

  onExportProgress: (_callback: (progress: ExportProgress) => void): (() => void) => {
    // In the web app, export progress would come via SSE from the export endpoint.
    return () => {}
  },

  // ── AI Conversations ──

  createConversation: (sessionId: string, title?: string) =>
    post<AIConversation>(`/ai-conversations/${sessionId}`, { title }),

  getConversations: (sessionId: string) =>
    get<AIConversation[]>(`/ai-conversations/${sessionId}`),

  getConversation: (conversationId: string) =>
    get<AIConversation | null>(`/ai-conversations/detail/${conversationId}`),

  updateConversationTitle: (conversationId: string, title: string) =>
    put<{ success: boolean }>(`/ai-conversations/${conversationId}/title`, { title }).then((r) => r.success ?? true),

  deleteConversation: (conversationId: string) =>
    del<{ success: boolean }>(`/ai-conversations/${conversationId}`).then((r) => r.success ?? true),

  addMessage: (
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    dataKeywords?: string[],
    dataMessageCount?: number,
    contentBlocks?: ContentBlock[],
  ) =>
    post<AIMessage>(`/ai-conversations/${conversationId}/messages`, {
      role,
      content,
      dataKeywords,
      dataMessageCount,
      contentBlocks,
    }),

  getMessages: (conversationId: string) =>
    get<AIMessage[]>(`/ai-conversations/${conversationId}/messages`),

  deleteMessage: (messageId: string) =>
    del<{ success: boolean }>(`/ai-conversations/messages/${messageId}`).then((r) => r.success ?? true),

  showAiLogFile: () =>
    get<{ success: boolean; path?: string; error?: string }>('/cache/import-log'),

  getDefaultDesensitizeRules: (locale: string) =>
    get<DesensitizeRule[]>('/agent/desensitize-rules', { locale }),

  mergeDesensitizeRules: (existingRules: DesensitizeRule[], locale: string) =>
    post<DesensitizeRule[]>('/agent/merge-desensitize-rules', { existingRules, locale }),
}
