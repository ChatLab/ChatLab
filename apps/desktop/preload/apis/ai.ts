/**
 * AI 相关 API — 仅保留 IPC 必须的能力
 *
 * Conversation/message CRUD 和 debug 已迁移到 HTTP 共享路由（FetchAIAdapter），
 * 此处只保留需要 worker、native shell、工具注册表等 IPC 才能提供的功能。
 */
import { ipcRenderer } from 'electron'
import type { ExportProgress } from '../../../../src/types/base'

// Agent API 类型 — 从 shared/types 统一导入
export type { TokenUsage, AgentRuntimeStatus } from '../../shared/types'
import type { TokenUsage, AgentRuntimeStatus, SerializedErrorInfo } from '../../shared/types'

export type { SerializedErrorInfo } from '../../shared/types'

// ==================== 类型定义 ====================

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
  error?: string
  thinking?: string
  thinkingDone?: boolean
}

export interface AgentStreamChunk {
  type: 'content' | 'think' | 'tool_start' | 'tool_result' | 'status' | 'compression_done' | 'done' | 'error'
  content?: string
  thinkTag?: string
  thinkDurationMs?: number
  toolName?: string
  toolParams?: Record<string, unknown>
  toolResult?: unknown
  status?: AgentRuntimeStatus
  error?: SerializedErrorInfo
  isFinished?: boolean
  compressionResult?: {
    summaryContent: string
    tokensBefore: number
    tokensAfter: number
    timestamp: number
  }
  usage?: TokenUsage
}

export interface AgentResult {
  content: string
  toolsUsed: string[]
  toolRounds: number
  error?: SerializedErrorInfo
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

export interface ToolContext {
  sessionId: string
  conversationId?: string
  historyLeafMessageId?: string | null
  timeFilter?: { startTs: number; endTs: number }
  maxMessagesLimit?: number
  ownerInfo?: { platformId: string; displayName: string }
  mentionedMembers?: Array<{
    memberId: number
    platformId: string
    displayName: string
    aliases: string[]
    mentionText: string
  }>
  locale?: string
  preprocessConfig?: PreprocessConfig
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

// ==================== LLM API ====================

export const llmApi = {
  chat: (
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<{ success: boolean; content?: string; error?: string }> => {
    return ipcRenderer.invoke('llm:chat', messages, options)
  },

  chatStream: (
    messages: ChatMessage[],
    options?: ChatOptions,
    onChunk?: (chunk: ChatStreamChunk) => void
  ): Promise<{ success: boolean; error?: string }> => {
    return new Promise((resolve) => {
      const requestId = `llm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      console.log('[preload] chatStream 开始，requestId:', requestId)

      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { requestId: string; chunk: ChatStreamChunk; error?: string }
      ) => {
        if (data.requestId === requestId) {
          if (data.error) {
            console.log('[preload] chatStream 收到错误:', data.error)
            if (onChunk) {
              onChunk({ content: '', isFinished: true, finishReason: 'error', error: data.error })
            }
            ipcRenderer.removeListener('llm:streamChunk', handler)
            resolve({ success: false, error: data.error })
          } else {
            if (onChunk) {
              onChunk(data.chunk)
            }

            if (data.chunk.isFinished) {
              console.log('[preload] chatStream 完成，requestId:', requestId)
              ipcRenderer.removeListener('llm:streamChunk', handler)
              resolve({ success: true })
            }
          }
        }
      }

      ipcRenderer.on('llm:streamChunk', handler)

      ipcRenderer
        .invoke('llm:chatStream', requestId, messages, options)
        .then((result) => {
          console.log('[preload] chatStream invoke 返回:', result)
          if (!result.success) {
            ipcRenderer.removeListener('llm:streamChunk', handler)
            resolve(result)
          }
        })
        .catch((error) => {
          console.error('[preload] chatStream invoke 错误:', error)
          ipcRenderer.removeListener('llm:streamChunk', handler)
          resolve({ success: false, error: String(error) })
        })
    })
  },
}

// ==================== Agent API ====================

export const agentApi = {
  runStream: (
    userMessage: string,
    context: ToolContext,
    onChunk?: (chunk: AgentStreamChunk) => void,
    chatType?: 'group' | 'private',
    locale?: string,
    assistantId?: string,
    skillId?: string | null,
    enableAutoSkill?: boolean,
    compressionConfig?: {
      enabled: boolean
      tokenThresholdPercent: number
      bufferSizePercent: number
      maxToolResultPercent?: number
    },
    thinkingLevel?: string
  ): {
    requestId: string
    promise: Promise<{ success: boolean; result?: AgentResult; error?: SerializedErrorInfo }>
  } => {
    const sanitizedContext: ToolContext = {
      sessionId: context.sessionId,
      conversationId: context.conversationId,
      historyLeafMessageId: context.historyLeafMessageId,
      timeFilter: context.timeFilter
        ? {
            startTs: context.timeFilter.startTs,
            endTs: context.timeFilter.endTs,
          }
        : undefined,
      maxMessagesLimit: context.maxMessagesLimit,
      ownerInfo: context.ownerInfo
        ? {
            platformId: context.ownerInfo.platformId,
            displayName: context.ownerInfo.displayName,
          }
        : undefined,
      mentionedMembers: context.mentionedMembers
        ? context.mentionedMembers.map((member) => ({
            memberId: member.memberId,
            platformId: member.platformId,
            displayName: member.displayName,
            aliases: [...member.aliases],
            mentionText: member.mentionText,
          }))
        : undefined,
      locale: context.locale,
      preprocessConfig: context.preprocessConfig,
    }

    const requestId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    console.log(
      '[preload] Agent runStream 开始，requestId:',
      requestId,
      'conversationId:',
      sanitizedContext.conversationId ?? 'none',
      'chatType:',
      chatType ?? 'group'
    )

    const promise = new Promise<{ success: boolean; result?: AgentResult; error?: SerializedErrorInfo }>((resolve) => {
      const chunkHandler = (
        _event: Electron.IpcRendererEvent,
        data: { requestId: string; chunk: AgentStreamChunk }
      ) => {
        if (data.requestId === requestId) {
          if (onChunk) {
            onChunk(data.chunk)
          }
        }
      }

      const completeHandler = (
        _event: Electron.IpcRendererEvent,
        data: { requestId: string; result: AgentResult & { error?: SerializedErrorInfo } }
      ) => {
        if (data.requestId === requestId) {
          console.log('[preload] Agent 完成，requestId:', requestId, 'hasError:', !!data.result?.error)
          ipcRenderer.removeListener('agent:streamChunk', chunkHandler)
          ipcRenderer.removeListener('agent:complete', completeHandler)
          if (data.result?.error) {
            resolve({ success: false, error: data.result.error })
          } else {
            resolve({ success: true, result: data.result })
          }
        }
      }

      ipcRenderer.on('agent:streamChunk', chunkHandler)
      ipcRenderer.on('agent:complete', completeHandler)

      ipcRenderer
        .invoke(
          'agent:runStream',
          requestId,
          userMessage,
          sanitizedContext,
          chatType,
          locale,
          assistantId,
          skillId,
          enableAutoSkill,
          compressionConfig,
          thinkingLevel
        )
        .then((result) => {
          console.log('[preload] Agent invoke 返回:', result)
          if (!result.success) {
            ipcRenderer.removeListener('agent:streamChunk', chunkHandler)
            ipcRenderer.removeListener('agent:complete', completeHandler)
            resolve(result)
          }
        })
        .catch((error) => {
          console.error('[preload] Agent invoke 错误:', error)
          ipcRenderer.removeListener('agent:streamChunk', chunkHandler)
          ipcRenderer.removeListener('agent:complete', completeHandler)
          resolve({
            success: false,
            error: {
              name: error instanceof Error ? error.name : null,
              message: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? (error.stack ?? null) : null,
            },
          })
        })
    })

    return { requestId, promise }
  },

  abort: (requestId: string): Promise<{ success: boolean; error?: string }> => {
    console.log('[preload] Agent abort 请求，requestId:', requestId)
    return ipcRenderer.invoke('agent:abort', requestId)
  },
}
