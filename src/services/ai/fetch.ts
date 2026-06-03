/**
 * CLI Web 模式下的 AIAdapter 实现
 *
 * 通过 HTTP 调用 chatlab start 后端的 /_web/ai/* 端点。
 * 不支持 Web 模式的功能（文件导出等）返回安全的降级响应。
 */

import type {
  AIAdapter,
  AIConversation,
  AIMessage,
  AIMessageRole,
  ContentBlock,
  TokenUsageData,
  FilterResultWithPagination,
  ExportFilterParams,
  ExportProgress,
  AiSQLResult,
  AiSchemaTable,
  ToolCatalogEntry,
  ToolExecuteResult,
  DesensitizeRule,
} from './types'
import type { TimeFilter } from '@/types/base'
import { get, post, put, del } from '../utils/http'

const NOT_AVAILABLE_WEB = 'This feature is not available in web mode'

export class FetchAIAdapter implements AIAdapter {
  // ===== 对话管理 =====
  async getConversation(conversationId: string): Promise<AIConversation | null> {
    try {
      return await get<AIConversation>(`/ai/conversations/${conversationId}`)
    } catch {
      return null
    }
  }

  async getConversations(sessionId: string): Promise<AIConversation[]> {
    return get<AIConversation[]>(`/ai/conversations?sessionId=${encodeURIComponent(sessionId)}`)
  }

  async createConversation(sessionId: string, title: string | undefined, assistantId: string): Promise<AIConversation> {
    return post<AIConversation>('/ai/conversations', { sessionId, title, assistantId })
  }

  async updateConversationTitle(conversationId: string, title: string): Promise<boolean> {
    return put<boolean>(`/ai/conversations/${conversationId}/title`, { title })
  }

  async deleteConversation(conversationId: string): Promise<boolean> {
    return del<boolean>(`/ai/conversations/${conversationId}`)
  }

  // ===== 消息 =====
  async getMessages(conversationId: string): Promise<AIMessage[]> {
    return get<AIMessage[]>(`/ai/conversations/${conversationId}/messages`)
  }

  async addMessage(
    conversationId: string,
    role: AIMessageRole,
    content: string,
    dataKeywords?: string[],
    dataMessageCount?: number,
    contentBlocks?: ContentBlock[],
    tokenUsage?: TokenUsageData
  ): Promise<AIMessage> {
    return post<AIMessage>(`/ai/conversations/${conversationId}/messages`, {
      role,
      content,
      dataKeywords,
      dataMessageCount,
      contentBlocks,
      tokenUsage,
    })
  }

  async deleteMessagesFrom(conversationId: string, messageId: string): Promise<void> {
    return post<void>(`/ai/conversations/${conversationId}/messages/${messageId}/delete-from`, {})
  }

  async forkConversation(sourceConversationId: string, upToMessageId: string, title?: string): Promise<AIConversation> {
    return post<AIConversation>(`/ai/conversations/${sourceConversationId}/fork`, { upToMessageId, title })
  }

  async updateMessageContent(messageId: string, newContent: string): Promise<void> {
    await put<unknown>(`/ai/messages/${messageId}/content`, { content: newContent })
  }

  async deleteAndRelinkMessage(conversationId: string, messageId: string): Promise<void> {
    await post<unknown>(`/ai/conversations/${conversationId}/messages/${messageId}/delete-relink`, {})
  }

  async insertMessageAfter(
    conversationId: string,
    afterMessageId: string,
    role: AIMessageRole,
    content: string,
    contentBlocks?: ContentBlock[],
    tokenUsage?: TokenUsageData
  ): Promise<AIMessage> {
    return post<AIMessage>(`/ai/conversations/${conversationId}/messages/insert-after`, {
      afterMessageId,
      role,
      content,
      contentBlocks,
      tokenUsage,
    })
  }

  async getConversationTokenUsage(conversationId: string): Promise<TokenUsageData> {
    return get<TokenUsageData>(`/ai/conversations/${conversationId}/token-usage`)
  }

  async estimateContextTokens(
    conversationId: string
  ): Promise<{ success: boolean; tokens: number; messageCount?: number; error?: string }> {
    try {
      return await get<{ success: boolean; tokens: number; messageCount?: number }>(
        `/ai/conversations/${conversationId}/estimate-tokens`
      )
    } catch (error) {
      return { success: false, tokens: 0, error: error instanceof Error ? error.message : String(error) }
    }
  }

  // ===== 消息筛选 =====
  async filterMessagesWithContext(
    sessionId: string,
    keywords?: string[],
    timeFilter?: TimeFilter,
    senderIds?: number[],
    contextSize?: number,
    page?: number,
    pageSize?: number
  ): Promise<FilterResultWithPagination> {
    try {
      return await post<FilterResultWithPagination>('/ai/filter-messages', {
        sessionId,
        keywords,
        timeFilter,
        senderIds,
        contextSize,
        page,
        pageSize,
      })
    } catch {
      return {
        blocks: [],
        stats: { totalMessages: 0, hitMessages: 0, totalChars: 0 },
        pagination: { page: 1, pageSize: 50, totalBlocks: 0, totalHits: 0, hasMore: false },
      }
    }
  }

  async getMultipleSessionsMessages(
    sessionId: string,
    chatSessionIds: number[],
    page?: number,
    pageSize?: number
  ): Promise<FilterResultWithPagination> {
    try {
      return await post<FilterResultWithPagination>('/ai/multiple-sessions-messages', {
        sessionId,
        chatSessionIds,
        page,
        pageSize,
      })
    } catch {
      return {
        blocks: [],
        stats: { totalMessages: 0, hitMessages: 0, totalChars: 0 },
        pagination: { page: 1, pageSize: 50, totalBlocks: 0, totalHits: 0, hasMore: false },
      }
    }
  }

  async exportFilterResultToFile(
    _params: ExportFilterParams
  ): Promise<{ success: boolean; filePath?: string; error?: string }> {
    return { success: false, error: NOT_AVAILABLE_WEB }
  }

  onExportProgress(_callback: (progress: ExportProgress) => void): () => void {
    return () => {}
  }

  // ===== 调试 =====
  async executeAiSQL(sql: string): Promise<AiSQLResult> {
    return post<AiSQLResult>('/ai/debug/execute-sql', { sql })
  }

  async getAiSchema(): Promise<AiSchemaTable[]> {
    return get<AiSchemaTable[]>('/ai/debug/schema')
  }

  async clearDebugContext(): Promise<{ success: boolean; cleared: number }> {
    return post<{ success: boolean; cleared: number }>('/ai/debug/clear-debug-context', {})
  }

  // ===== 工具 =====
  async getToolCatalog(): Promise<ToolCatalogEntry[]> {
    try {
      return await get<ToolCatalogEntry[]>('/ai/tools/full-catalog')
    } catch {
      return get<ToolCatalogEntry[]>('/ai/tools/catalog')
    }
  }

  async executeTool(
    testId: string,
    toolName: string,
    params: Record<string, unknown>,
    sessionId: string
  ): Promise<ToolExecuteResult> {
    try {
      return await post<ToolExecuteResult>('/ai/tools/execute', { testId, toolName, params, sessionId })
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async cancelToolTest(testId: string): Promise<{ success: boolean }> {
    try {
      return await post<{ success: boolean }>('/ai/tools/cancel', { testId })
    } catch {
      return { success: false }
    }
  }

  // ===== 脱敏 =====
  async getDefaultDesensitizeRules(locale: string): Promise<DesensitizeRule[]> {
    try {
      return await get<DesensitizeRule[]>(`/ai/desensitize-rules/defaults?locale=${encodeURIComponent(locale)}`)
    } catch {
      return []
    }
  }

  async mergeDesensitizeRules(
    existingRules: DesensitizeRule[],
    locale: string,
    overrides: Record<string, boolean> = {}
  ): Promise<DesensitizeRule[]> {
    try {
      return await post<DesensitizeRule[]>('/ai/desensitize-rules/merge', { existingRules, locale, overrides })
    } catch {
      return existingRules
    }
  }

  // ===== 日志 =====
  async showAiLogFile(): Promise<{ success: boolean; path?: string; error?: string }> {
    return { success: false, error: NOT_AVAILABLE_WEB }
  }
}
