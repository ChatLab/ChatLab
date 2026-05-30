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

export class ElectronAIAdapter implements AIAdapter {
  // ===== 对话管理 =====
  async getConversation(conversationId: string): Promise<AIConversation | null> {
    return window.aiApi.getConversation(conversationId)
  }

  async getConversations(sessionId: string): Promise<AIConversation[]> {
    return window.aiApi.getConversations(sessionId)
  }

  async createConversation(sessionId: string, title: string | undefined, assistantId: string): Promise<AIConversation> {
    return window.aiApi.createConversation(sessionId, title, assistantId)
  }

  async updateConversationTitle(conversationId: string, title: string): Promise<boolean> {
    return window.aiApi.updateConversationTitle(conversationId, title)
  }

  async deleteConversation(conversationId: string): Promise<boolean> {
    return window.aiApi.deleteConversation(conversationId)
  }

  // ===== 消息 =====
  async getMessages(conversationId: string): Promise<AIMessage[]> {
    return window.aiApi.getMessages(conversationId) as Promise<AIMessage[]>
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
    return window.aiApi.addMessage(
      conversationId,
      role as any,
      content,
      dataKeywords,
      dataMessageCount,
      contentBlocks as any,
      tokenUsage
    ) as Promise<AIMessage>
  }

  async deleteMessagesFrom(conversationId: string, messageId: string): Promise<void> {
    return window.aiApi.deleteMessagesFrom(conversationId, messageId)
  }

  async forkConversation(sourceConversationId: string, upToMessageId: string, title?: string): Promise<AIConversation> {
    return window.aiApi.forkConversation(sourceConversationId, upToMessageId, title) as Promise<AIConversation>
  }

  async updateMessageContent(messageId: string, newContent: string): Promise<void> {
    return window.aiApi.updateMessageContent(messageId, newContent)
  }

  async deleteAndRelinkMessage(conversationId: string, messageId: string): Promise<void> {
    return window.aiApi.deleteAndRelinkMessage(conversationId, messageId)
  }

  async insertMessageAfter(
    conversationId: string,
    afterMessageId: string,
    role: AIMessageRole,
    content: string,
    contentBlocks?: ContentBlock[],
    tokenUsage?: TokenUsageData
  ): Promise<AIMessage> {
    return window.aiApi.insertMessageAfter(
      conversationId,
      afterMessageId,
      role,
      content,
      contentBlocks as any,
      tokenUsage
    ) as Promise<AIMessage>
  }

  async getConversationTokenUsage(conversationId: string): Promise<TokenUsageData> {
    return window.aiApi.getConversationTokenUsage(conversationId)
  }

  async estimateContextTokens(
    conversationId: string
  ): Promise<{ success: boolean; tokens: number; messageCount?: number; error?: string }> {
    return window.aiApi.estimateContextTokens(conversationId)
  }

  // ===== 消息筛选/导出 =====
  async filterMessagesWithContext(
    sessionId: string,
    keywords?: string[],
    timeFilter?: TimeFilter,
    senderIds?: number[],
    contextSize?: number,
    page?: number,
    pageSize?: number
  ): Promise<FilterResultWithPagination> {
    return window.aiApi.filterMessagesWithContext(
      sessionId,
      keywords,
      timeFilter,
      senderIds,
      contextSize,
      page,
      pageSize
    )
  }

  async getMultipleSessionsMessages(
    sessionId: string,
    chatSessionIds: number[],
    page?: number,
    pageSize?: number
  ): Promise<FilterResultWithPagination> {
    return window.aiApi.getMultipleSessionsMessages(sessionId, chatSessionIds, page, pageSize)
  }

  async exportFilterResultToFile(
    params: ExportFilterParams
  ): Promise<{ success: boolean; filePath?: string; error?: string }> {
    return window.aiApi.exportFilterResultToFile(params)
  }

  onExportProgress(callback: (progress: ExportProgress) => void): () => void {
    return window.aiApi.onExportProgress(callback)
  }

  // ===== 调试 =====
  async executeAiSQL(sql: string): Promise<AiSQLResult> {
    return window.aiApi.executeAiSQL(sql)
  }

  async getAiSchema(): Promise<AiSchemaTable[]> {
    return window.aiApi.getAiSchema()
  }

  async clearDebugContext(): Promise<{ success: boolean; cleared: number }> {
    return window.aiApi.clearDebugContext()
  }

  // ===== 工具 =====
  async getToolCatalog(): Promise<ToolCatalogEntry[]> {
    return window.aiApi.getToolCatalog()
  }

  async executeTool(
    testId: string,
    toolName: string,
    params: Record<string, unknown>,
    sessionId: string
  ): Promise<ToolExecuteResult> {
    return window.aiApi.executeTool(testId, toolName, params, sessionId)
  }

  async cancelToolTest(testId: string): Promise<{ success: boolean }> {
    return window.aiApi.cancelToolTest(testId)
  }

  // ===== 脱敏 =====
  async getDefaultDesensitizeRules(locale: string): Promise<DesensitizeRule[]> {
    return window.aiApi.getDefaultDesensitizeRules(locale)
  }

  async mergeDesensitizeRules(existingRules: DesensitizeRule[], locale: string): Promise<DesensitizeRule[]> {
    return window.aiApi.mergeDesensitizeRules(existingRules, locale)
  }

  // ===== 日志 =====
  async showAiLogFile(): Promise<{ success: boolean; path?: string; error?: string }> {
    return window.aiApi.showAiLogFile()
  }
}
