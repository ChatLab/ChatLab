/**
 * CLI Web 模式下的 AIAdapter 实现
 *
 * 通过 HTTP 调用 clb web 后端的 /_web/ai/* 端点。
 * 不支持 Web 模式的功能（文件导出等）返回安全的降级响应。
 */

import type {
  AIAdapter,
  AIChat,
  AIMessage,
  AIMessageRole,
  AIEntityRef,
  ContentBlock,
  TokenUsageData,
  ExportFilterParams,
  ExportProgress,
  AiSQLResult,
  AiSchemaTable,
  ToolCatalogEntry,
  ToolExecuteResult,
  DesensitizeRule,
  AIMemoryEntry,
  AIMemoryScope,
  CreateUserAIMemoryInput,
  ClearAIMemoriesInput,
} from './types'
import { get, post, put, del, fetchWithAuth } from '../utils/http'

const NOT_AVAILABLE_WEB = 'This feature is not available in web mode'

export class FetchAIAdapter implements AIAdapter {
  // ===== 对话管理 =====
  async getAIChat(aiChatId: string): Promise<AIChat | null> {
    try {
      return await get<AIChat>(`/ai/chats/${aiChatId}`)
    } catch {
      return null
    }
  }

  async getAIChats(sessionId: string): Promise<AIChat[]> {
    return get<AIChat[]>(`/ai/chats?sessionId=${encodeURIComponent(sessionId)}`)
  }

  async getGlobalAIChats(): Promise<AIChat[]> {
    return get<AIChat[]>('/ai/global-chats')
  }

  async createAIChat(sessionId: string, title: string | undefined, assistantId: string): Promise<AIChat> {
    return post<AIChat>('/ai/chats', { sessionId, title, assistantId })
  }

  async createGlobalAIChat(title: string | undefined, assistantId: string): Promise<AIChat> {
    return post<AIChat>('/ai/global-chats', { title, assistantId })
  }

  async updateAIChatTitle(aiChatId: string, title: string): Promise<boolean> {
    return put<boolean>(`/ai/chats/${aiChatId}/title`, { title })
  }

  async deleteAIChat(aiChatId: string): Promise<boolean> {
    return del<boolean>(`/ai/chats/${aiChatId}`)
  }

  // ===== 长期记忆 =====
  async getAIMemories(scope?: AIMemoryScope): Promise<AIMemoryEntry[]> {
    if (!scope) return get<AIMemoryEntry[]>('/ai/memories')
    const params = new URLSearchParams({ scopeType: scope.scopeType })
    if (scope.scopeId) params.set('scopeId', scope.scopeId)
    return get<AIMemoryEntry[]>(`/ai/memories?${params.toString()}`)
  }

  async createAIMemory(input: CreateUserAIMemoryInput): Promise<AIMemoryEntry> {
    return post<AIMemoryEntry>('/ai/memories', input)
  }

  async updateAIMemory(id: string, content: string): Promise<AIMemoryEntry> {
    return put<AIMemoryEntry>(`/ai/memories/${id}`, { content })
  }

  async deleteAIMemory(id: string): Promise<{ success: boolean }> {
    return del<{ success: boolean }>(`/ai/memories/${id}`)
  }

  async clearAIMemories(input: ClearAIMemoriesInput): Promise<{ success: boolean; cleared: number }> {
    return post<{ success: boolean; cleared: number }>('/ai/memories/clear', input)
  }

  // ===== 消息 =====
  async getMessages(aiChatId: string): Promise<AIMessage[]> {
    return get<AIMessage[]>(`/ai/chats/${aiChatId}/messages`)
  }

  async addMessagePair(
    aiChatId: string,
    userMessage: { content: string; entityRefs?: AIEntityRef[] },
    assistantMessage: { content: string; contentBlocks?: ContentBlock[]; tokenUsage?: TokenUsageData }
  ): Promise<{ userMessage: AIMessage; assistantMessage: AIMessage }> {
    return post<{ userMessage: AIMessage; assistantMessage: AIMessage }>(`/ai/chats/${aiChatId}/message-pair`, {
      userMessage,
      assistantMessage,
    })
  }

  async addMessage(
    aiChatId: string,
    role: AIMessageRole,
    content: string,
    dataKeywords?: string[],
    dataMessageCount?: number,
    contentBlocks?: ContentBlock[],
    tokenUsage?: TokenUsageData,
    entityRefs?: AIEntityRef[]
  ): Promise<AIMessage> {
    return post<AIMessage>(`/ai/chats/${aiChatId}/messages`, {
      role,
      content,
      dataKeywords,
      dataMessageCount,
      contentBlocks,
      tokenUsage,
      entityRefs,
    })
  }

  async deleteMessagesFrom(aiChatId: string, messageId: string): Promise<void> {
    return post<void>(`/ai/chats/${aiChatId}/messages/${messageId}/delete-from`, {})
  }

  async forkAIChat(sourceAIChatId: string, upToMessageId: string, title?: string): Promise<AIChat> {
    return post<AIChat>(`/ai/chats/${sourceAIChatId}/fork`, { upToMessageId, title })
  }

  async updateMessageContent(messageId: string, newContent: string, entityRefs?: AIEntityRef[]): Promise<void> {
    await put<unknown>(`/ai/messages/${messageId}/content`, { content: newContent, entityRefs })
  }

  async deleteAndRelinkMessage(aiChatId: string, messageId: string): Promise<void> {
    await post<unknown>(`/ai/chats/${aiChatId}/messages/${messageId}/delete-relink`, {})
  }

  async insertMessageAfter(
    aiChatId: string,
    afterMessageId: string,
    role: AIMessageRole,
    content: string,
    contentBlocks?: ContentBlock[],
    tokenUsage?: TokenUsageData,
    entityRefs?: AIEntityRef[]
  ): Promise<AIMessage> {
    return post<AIMessage>(`/ai/chats/${aiChatId}/messages/insert-after`, {
      afterMessageId,
      role,
      content,
      contentBlocks,
      tokenUsage,
      entityRefs,
    })
  }

  async getAIChatTokenUsage(aiChatId: string): Promise<TokenUsageData> {
    return get<TokenUsageData>(`/ai/chats/${aiChatId}/token-usage`)
  }

  async estimateContextTokens(
    aiChatId: string
  ): Promise<{ success: boolean; tokens: number; messageCount?: number; error?: string }> {
    try {
      return await get<{ success: boolean; tokens: number; messageCount?: number }>(
        `/ai/chats/${aiChatId}/estimate-tokens`
      )
    } catch (error) {
      return { success: false, tokens: 0, error: error instanceof Error ? error.message : String(error) }
    }
  }

  // ===== 消息导出 =====
  async exportFilterResultToFile(
    params: ExportFilterParams
  ): Promise<{ success: boolean; filePath?: string; error?: string }> {
    try {
      const resp = await fetchWithAuth(`/_web/sessions/${params.sessionId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionName: params.sessionName,
          format: params.format || 'txt',
          timeFilter: params.timeFilter,
        }),
      })
      if (!resp.ok) {
        const body = await resp.json().catch(() => null)
        const error = body?.error || `HTTP ${resp.status}`
        return { success: false, error }
      }
      const blob = await resp.blob()
      const filename =
        resp.headers.get('Content-Disposition')?.match(/filename="?(.+?)"?$/)?.[1] || `${params.sessionName}_export.txt`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = decodeURIComponent(filename)
      a.click()
      URL.revokeObjectURL(url)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
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

  async showAiLogFile(): Promise<{ success: boolean; path?: string; error?: string }> {
    try {
      return await post<{ success: boolean; path?: string; error?: string }>('/ai/logs/show')
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : NOT_AVAILABLE_WEB }
    }
  }
}
