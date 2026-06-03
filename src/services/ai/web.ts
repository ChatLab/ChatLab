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

const NOT_AVAILABLE = 'AI 对话功能暂不支持 Web 模式，请使用桌面客户端'

/**
 * Web 模式下的 AIAdapter 降级实现
 * AI 功能目前仅 Electron 端支持，此处提供安全的降级响应
 */
export class WebAIAdapter implements AIAdapter {
  // ===== 对话管理 =====
  async getConversation(_conversationId: string): Promise<AIConversation | null> {
    return null
  }

  async getConversations(_sessionId: string): Promise<AIConversation[]> {
    return []
  }

  async createConversation(
    _sessionId: string,
    _title: string | undefined,
    _assistantId: string
  ): Promise<AIConversation> {
    throw new Error(NOT_AVAILABLE)
  }

  async updateConversationTitle(_conversationId: string, _title: string): Promise<boolean> {
    return false
  }

  async deleteConversation(_conversationId: string): Promise<boolean> {
    return false
  }

  // ===== 消息 =====
  async getMessages(_conversationId: string): Promise<AIMessage[]> {
    return []
  }

  async addMessage(
    _conversationId: string,
    _role: AIMessageRole,
    _content: string,
    _dataKeywords?: string[],
    _dataMessageCount?: number,
    _contentBlocks?: ContentBlock[],
    _tokenUsage?: TokenUsageData
  ): Promise<AIMessage> {
    throw new Error(NOT_AVAILABLE)
  }

  async deleteMessagesFrom(_conversationId: string, _messageId: string): Promise<void> {
    throw new Error('AI message editing is not available in static web mode')
  }

  async forkConversation(
    _sourceConversationId: string,
    _upToMessageId: string,
    _title?: string
  ): Promise<AIConversation> {
    throw new Error('AI conversation forking is not available in static web mode')
  }

  async updateMessageContent(_messageId: string, _newContent: string): Promise<void> {
    throw new Error('AI message editing is not available in static web mode')
  }

  async deleteAndRelinkMessage(_conversationId: string, _messageId: string): Promise<void> {
    throw new Error('AI message editing is not available in static web mode')
  }

  async insertMessageAfter(
    _conversationId: string,
    _afterMessageId: string,
    _role: AIMessageRole,
    _content: string,
    _contentBlocks?: ContentBlock[],
    _tokenUsage?: TokenUsageData
  ): Promise<AIMessage> {
    throw new Error('AI message editing is not available in static web mode')
  }

  async getConversationTokenUsage(_conversationId: string): Promise<TokenUsageData> {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  }

  async estimateContextTokens(
    _conversationId: string
  ): Promise<{ success: boolean; tokens: number; messageCount?: number; error?: string }> {
    return { success: false, tokens: 0, error: NOT_AVAILABLE }
  }

  // ===== 消息筛选/导出 =====
  async filterMessagesWithContext(
    _sessionId: string,
    _keywords?: string[],
    _timeFilter?: TimeFilter,
    _senderIds?: number[],
    _contextSize?: number,
    _page?: number,
    _pageSize?: number
  ): Promise<FilterResultWithPagination> {
    return {
      blocks: [],
      stats: { totalMessages: 0, hitMessages: 0, totalChars: 0 },
      pagination: { page: 1, pageSize: 50, totalBlocks: 0, totalHits: 0, hasMore: false },
    }
  }

  async getMultipleSessionsMessages(
    _sessionId: string,
    _chatSessionIds: number[],
    _page?: number,
    _pageSize?: number
  ): Promise<FilterResultWithPagination> {
    return {
      blocks: [],
      stats: { totalMessages: 0, hitMessages: 0, totalChars: 0 },
      pagination: { page: 1, pageSize: 50, totalBlocks: 0, totalHits: 0, hasMore: false },
    }
  }

  async exportFilterResultToFile(
    _params: ExportFilterParams
  ): Promise<{ success: boolean; filePath?: string; error?: string }> {
    return { success: false, error: NOT_AVAILABLE }
  }

  onExportProgress(_callback: (progress: ExportProgress) => void): () => void {
    return () => {}
  }

  // ===== 调试 =====
  async executeAiSQL(_sql: string): Promise<AiSQLResult> {
    return { columns: [], rows: [], rowCount: 0, duration: 0, limited: false }
  }

  async getAiSchema(): Promise<AiSchemaTable[]> {
    return []
  }

  async clearDebugContext(): Promise<{ success: boolean; cleared: number }> {
    return { success: false, cleared: 0 }
  }

  // ===== 工具 =====
  async getToolCatalog(): Promise<ToolCatalogEntry[]> {
    return []
  }

  async executeTool(
    _testId: string,
    _toolName: string,
    _params: Record<string, unknown>,
    _sessionId: string
  ): Promise<ToolExecuteResult> {
    return { success: false, error: NOT_AVAILABLE }
  }

  async cancelToolTest(_testId: string): Promise<{ success: boolean }> {
    return { success: false }
  }

  // ===== 脱敏 =====
  async getDefaultDesensitizeRules(_locale: string): Promise<DesensitizeRule[]> {
    return []
  }

  async mergeDesensitizeRules(
    existingRules: DesensitizeRule[],
    _locale: string,
    _overrides: Record<string, boolean> = {}
  ): Promise<DesensitizeRule[]> {
    return existingRules
  }

  // ===== 日志 =====
  async showAiLogFile(): Promise<{ success: boolean; path?: string; error?: string }> {
    return { success: false, error: NOT_AVAILABLE }
  }
}
