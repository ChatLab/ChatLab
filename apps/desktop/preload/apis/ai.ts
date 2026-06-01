/**
 * AI 相关 API — 仅保留 IPC 必须的能力
 *
 * Conversation/message CRUD 已迁移到 HTTP 共享路由（FetchAIAdapter）。
 * LLM/Agent streaming 已迁移到 SSE 共享路由（useAgentStreamService/useLlmStreamService）。
 * 此处只保留需要 worker、native shell、工具注册表等 IPC 才能提供的功能。
 */
import { ipcRenderer } from 'electron'
import type { ExportProgress } from '../../../../src/types/base'

export type { TokenUsage, AgentRuntimeStatus, SerializedErrorInfo } from '../../shared/types'

// ==================== 类型定义 ====================

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  temperature?: number
  maxTokens?: number
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

export interface ToolCatalogEntry {
  name: string
  category: 'core' | 'analysis'
  description: string
  parameters: Record<string, unknown>
}

export interface ToolExecuteResult {
  success: boolean
  elapsed?: number
  content?: Array<{ type: string; text: string }>
  details?: Record<string, unknown>
  error?: string
  truncated?: boolean
}

export interface PreprocessConfig {
  dataCleaning: boolean
  mergeConsecutive: boolean
  mergeWindowSeconds?: number
  blacklistKeywords: string[]
  denoise: boolean
  desensitize: boolean
  desensitizeRules: DesensitizeRule[]
  anonymizeNames: boolean
}

// ==================== AI API (IPC-only subset) ====================

export const aiApi = {
  // ===== 消息筛选/导出（worker-dependent） =====

  filterMessagesWithContext: (
    sessionId: string,
    keywords?: string[],
    timeFilter?: { startTs: number; endTs: number },
    senderIds?: number[],
    contextSize?: number,
    page?: number,
    pageSize?: number
  ): Promise<{
    blocks: Array<{
      startTs: number
      endTs: number
      messages: Array<{
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
      }>
      hitCount: number
    }>
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
  }> => {
    return ipcRenderer.invoke(
      'ai:filterMessagesWithContext',
      sessionId,
      keywords,
      timeFilter,
      senderIds,
      contextSize,
      page,
      pageSize
    )
  },

  getMultipleSessionsMessages: (
    sessionId: string,
    chatSessionIds: number[],
    page?: number,
    pageSize?: number
  ): Promise<{
    blocks: Array<{
      startTs: number
      endTs: number
      messages: Array<{
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
      }>
      hitCount: number
    }>
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
  }> => {
    return ipcRenderer.invoke('ai:getMultipleSessionsMessages', sessionId, chatSessionIds, page, pageSize)
  },

  exportFilterResultToFile: (params: {
    sessionId: string
    sessionName: string
    outputDir: string
    filterMode: 'condition' | 'session'
    keywords?: string[]
    timeFilter?: { startTs: number; endTs: number }
    senderIds?: number[]
    contextSize?: number
    chatSessionIds?: number[]
  }): Promise<{ success: boolean; filePath?: string; error?: string }> => {
    return ipcRenderer.invoke('ai:exportFilterResultToFile', params)
  },

  onExportProgress: (callback: (progress: ExportProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ExportProgress) => {
      callback(progress)
    }
    ipcRenderer.on('ai:exportProgress', handler)
    return () => {
      ipcRenderer.removeListener('ai:exportProgress', handler)
    }
  },

  // ===== 日志（native shell） =====

  showAiLogFile: (): Promise<{ success: boolean; path?: string; error?: string }> => {
    return ipcRenderer.invoke('ai:showLogFile')
  },

  // ===== 脱敏规则（node-runtime） =====

  getDefaultDesensitizeRules: (locale: string): Promise<DesensitizeRule[]> => {
    return ipcRenderer.invoke('ai:getDefaultDesensitizeRules', locale)
  },

  mergeDesensitizeRules: (existingRules: DesensitizeRule[], locale: string): Promise<DesensitizeRule[]> => {
    return ipcRenderer.invoke('ai:mergeDesensitizeRules', existingRules, locale)
  },

  // ===== 工具测试（tool registry on main process） =====

  getToolCatalog: (): Promise<ToolCatalogEntry[]> => {
    return ipcRenderer.invoke('ai:getToolCatalog')
  },

  executeTool: (
    testId: string,
    toolName: string,
    params: Record<string, unknown>,
    sessionId: string
  ): Promise<ToolExecuteResult> => {
    return ipcRenderer.invoke('ai:executeTool', testId, toolName, params, sessionId)
  },

  cancelToolTest: (testId: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('ai:cancelToolTest', testId)
  },

  // ===== 上下文估算（needs conversationManager） =====

  estimateContextTokens: (
    conversationId: string
  ): Promise<{ success: boolean; tokens: number; messageCount?: number; error?: string }> => {
    return ipcRenderer.invoke('ai:estimateContextTokens', conversationId)
  },
}

// LLM chat (non-streaming) still uses IPC for Electron-specific config resolution
export const llmApi = {
  chat: (
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<{ success: boolean; content?: string; error?: string }> => {
    return ipcRenderer.invoke('llm:chat', messages, options)
  },
}
