/**
 * AI 相关 API - AI 对话、LLM 服务、Agent、Embedding
 */
import { ipcRenderer } from 'electron'
import type { ExportProgress } from '../../../src/types/base'

// ==================== 类型定义 ====================

// AI API 类型
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
  assistantId: string
  createdAt: number
  updatedAt: number
}

// 内容块类型（用于 AI 消息的混合渲染）
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
  | { type: 'skill'; skillId: string; skillName: string }

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

// LLM API 类型
export interface LLMProvider {
  id: string
  name: string
  description: string
  defaultBaseUrl: string
  models: Array<{ id: string; name: string; description?: string }>
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

// Agent API 类型 — 从 shared/types 统一导入
export type { TokenUsage, AgentRuntimeStatus } from '../../shared/types'
import type { TokenUsage, AgentRuntimeStatus } from '../../shared/types'

export interface AgentStreamChunk {
  type: 'content' | 'think' | 'tool_start' | 'tool_result' | 'status' | 'done' | 'error'
  content?: string
  thinkTag?: string
  thinkDurationMs?: number
  toolName?: string
  toolParams?: Record<string, unknown>
  toolResult?: unknown
  status?: AgentRuntimeStatus
  error?: string
  isFinished?: boolean
  /** Token 使用量（type=done 时返回累计值） */
  usage?: TokenUsage
}

export interface AgentResult {
  content: string
  toolsUsed: string[]
  toolRounds: number
}

/** 单条脱敏规则 */
export interface DesensitizeRule {
  id: string
  label: string
  pattern: string
  replacement: string
  enabled: boolean
  builtin: boolean
  locales: string[]
}

/** 聊天记录预处理配置 */
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

// AI 服务配置类型（前端用）
export interface AIServiceConfigDisplay {
  id: string
  name: string
  provider: string
  apiKey: string // 脱敏后的 API Key
  apiKeySet: boolean
  model?: string
  baseUrl?: string
  maxTokens?: number
  disableThinking?: boolean
  isReasoningModel?: boolean
  createdAt: number
  updatedAt: number
}

// Embedding 服务配置（多配置模式）
export interface EmbeddingServiceConfig {
  id: string
  name: string
  apiSource: 'reuse_llm' | 'custom'
  model: string
  baseUrl?: string
  apiKey?: string
  createdAt: number
  updatedAt: number
}

// Embedding 配置展示用（隐藏 apiKey）
export interface EmbeddingServiceConfigDisplay {
  id: string
  name: string
  apiSource: 'reuse_llm' | 'custom'
  model: string
  baseUrl?: string
  apiKeySet: boolean
  createdAt: number
  updatedAt: number
}

// ==================== AI API ====================

export const aiApi = {
  /**
   * 搜索消息（关键词搜索）
   * @param senderId 可选的发送者成员 ID，用于筛选特定成员的消息
   */
  searchMessages: (
    sessionId: string,
    keywords: string[],
    filter?: { startTs?: number; endTs?: number },
    limit?: number,
    offset?: number,
    senderId?: number
  ): Promise<{ messages: SearchMessageResult[]; total: number }> => {
    return ipcRenderer.invoke('ai:searchMessages', sessionId, keywords, filter, limit, offset, senderId)
  },

  /**
   * 获取消息上下文
   * @param messageIds 支持单个或批量消息 ID
   */
  getMessageContext: (
    sessionId: string,
    messageIds: number | number[],
    contextSize?: number
  ): Promise<SearchMessageResult[]> => {
    return ipcRenderer.invoke('ai:getMessageContext', sessionId, messageIds, contextSize)
  },

  /**
   * 获取最近消息（AI Agent 专用）
   */
  getRecentMessages: (
    sessionId: string,
    filter?: { startTs?: number; endTs?: number },
    limit?: number
  ): Promise<{ messages: SearchMessageResult[]; total: number }> => {
    return ipcRenderer.invoke('ai:getRecentMessages', sessionId, filter, limit)
  },

  /**
   * 获取所有最近消息（消息查看器专用）
   */
  getAllRecentMessages: (
    sessionId: string,
    filter?: { startTs?: number; endTs?: number },
    limit?: number
  ): Promise<{ messages: SearchMessageResult[]; total: number }> => {
    return ipcRenderer.invoke('ai:getAllRecentMessages', sessionId, filter, limit)
  },

  /**
   * 获取两人之间的对话
   */
  getConversationBetween: (
    sessionId: string,
    memberId1: number,
    memberId2: number,
    filter?: { startTs?: number; endTs?: number },
    limit?: number
  ): Promise<{ messages: SearchMessageResult[]; total: number; member1Name: string; member2Name: string }> => {
    return ipcRenderer.invoke('ai:getConversationBetween', sessionId, memberId1, memberId2, filter, limit)
  },

  /**
   * 获取指定消息之前的 N 条（用于向上无限滚动）
   */
  getMessagesBefore: (
    sessionId: string,
    beforeId: number,
    limit?: number,
    filter?: { startTs?: number; endTs?: number },
    senderId?: number,
    keywords?: string[]
  ): Promise<{ messages: SearchMessageResult[]; hasMore: boolean }> => {
    return ipcRenderer.invoke('ai:getMessagesBefore', sessionId, beforeId, limit, filter, senderId, keywords)
  },

  /**
   * 获取指定消息之后的 N 条（用于向下无限滚动）
   */
  getMessagesAfter: (
    sessionId: string,
    afterId: number,
    limit?: number,
    filter?: { startTs?: number; endTs?: number },
    senderId?: number,
    keywords?: string[]
  ): Promise<{ messages: SearchMessageResult[]; hasMore: boolean }> => {
    return ipcRenderer.invoke('ai:getMessagesAfter', sessionId, afterId, limit, filter, senderId, keywords)
  },

  // ==================== 自定义筛选（支持分页） ====================

  /**
   * 筛选结果消息类型
   */
  // FilterMessage 和 FilterResult 类型定义在下方

  /**
   * 按条件筛选消息并扩充上下文（支持分页）
   * @param page 页码（从 1 开始，默认 1）
   * @param pageSize 每页块数（默认 50）
   */
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

  /**
   * 获取多个会话的完整消息（支持分页）
   * @param page 页码（从 1 开始，默认 1）
   * @param pageSize 每页块数（默认 50）
   */
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

  /**
   * 导出筛选结果到文件（后端生成，支持大数据量）
   */
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

  /**
   * 监听导出进度
   */
  onExportProgress: (callback: (progress: ExportProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ExportProgress) => {
      callback(progress)
    }
    ipcRenderer.on('ai:exportProgress', handler)
    return () => {
      ipcRenderer.removeListener('ai:exportProgress', handler)
    }
  },

  /**
   * 创建 AI 对话
   */
  createConversation: (sessionId: string, title?: string, assistantId?: string): Promise<AIConversation> => {
    return ipcRenderer.invoke('ai:createConversation', sessionId, title, assistantId)
  },

  /**
   * 获取会话的所有 AI 对话列表
   */
  getConversations: (sessionId: string): Promise<AIConversation[]> => {
    return ipcRenderer.invoke('ai:getConversations', sessionId)
  },

  /**
   * 获取单个 AI 对话
   */
  getConversation: (conversationId: string): Promise<AIConversation | null> => {
    return ipcRenderer.invoke('ai:getConversation', conversationId)
  },

  /**
   * 更新 AI 对话标题
   */
  updateConversationTitle: (conversationId: string, title: string): Promise<boolean> => {
    return ipcRenderer.invoke('ai:updateConversationTitle', conversationId, title)
  },

  /**
   * 删除 AI 对话
   */
  deleteConversation: (conversationId: string): Promise<boolean> => {
    return ipcRenderer.invoke('ai:deleteConversation', conversationId)
  },

  /**
   * 添加 AI 消息
   */
  addMessage: (
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    dataKeywords?: string[],
    dataMessageCount?: number,
    contentBlocks?: ContentBlock[]
  ): Promise<AIMessage> => {
    return ipcRenderer.invoke(
      'ai:addMessage',
      conversationId,
      role,
      content,
      dataKeywords,
      dataMessageCount,
      contentBlocks
    )
  },

  /**
   * 获取 AI 对话的所有消息
   */
  getMessages: (conversationId: string): Promise<AIMessage[]> => {
    return ipcRenderer.invoke('ai:getMessages', conversationId)
  },

  /**
   * 删除 AI 消息
   */
  deleteMessage: (messageId: string): Promise<boolean> => {
    return ipcRenderer.invoke('ai:deleteMessage', messageId)
  },

  /**
   * 打开当前 AI 日志文件并定位到文件
   */
  showAiLogFile: (): Promise<{ success: boolean; path?: string; error?: string }> => {
    return ipcRenderer.invoke('ai:showLogFile')
  },

  getDefaultDesensitizeRules: (locale: string): Promise<DesensitizeRule[]> => {
    return ipcRenderer.invoke('ai:getDefaultDesensitizeRules', locale)
  },

  mergeDesensitizeRules: (existingRules: DesensitizeRule[], locale: string): Promise<DesensitizeRule[]> => {
    return ipcRenderer.invoke('ai:mergeDesensitizeRules', existingRules, locale)
  },
}

// ==================== LLM API ====================

export const llmApi = {
  /**
   * 获取所有支持的 LLM 提供商
   */
  getProviders: (): Promise<LLMProvider[]> => {
    return ipcRenderer.invoke('llm:getProviders')
  },

  // ==================== 多配置管理 API ====================

  /**
   * 获取所有配置列表
   */
  getAllConfigs: (): Promise<AIServiceConfigDisplay[]> => {
    return ipcRenderer.invoke('llm:getAllConfigs')
  },

  /**
   * 获取当前激活的配置 ID
   */
  getActiveConfigId: (): Promise<string | null> => {
    return ipcRenderer.invoke('llm:getActiveConfigId')
  },

  /**
   * 添加新配置
   */
  addConfig: (config: {
    name: string
    provider: string
    apiKey: string
    model?: string
    baseUrl?: string
    maxTokens?: number
    disableThinking?: boolean
    isReasoningModel?: boolean
  }): Promise<{ success: boolean; config?: AIServiceConfigDisplay; error?: string }> => {
    return ipcRenderer.invoke('llm:addConfig', config)
  },

  /**
   * 更新配置
   */
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
    }
  ): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('llm:updateConfig', id, updates)
  },

  /**
   * 删除配置
   */
  deleteConfig: (id?: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('llm:deleteConfig', id)
  },

  /**
   * 设置激活的配置
   */
  setActiveConfig: (id: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('llm:setActiveConfig', id)
  },

  /**
   * 验证 API Key（支持自定义 baseUrl 和 model）
   */
  validateApiKey: (provider: string, apiKey: string, baseUrl?: string, model?: string): Promise<boolean> => {
    return ipcRenderer.invoke('llm:validateApiKey', provider, apiKey, baseUrl, model)
  },

  /**
   * 检查是否已配置 LLM（是否有激活的配置）
   */
  hasConfig: (): Promise<boolean> => {
    return ipcRenderer.invoke('llm:hasConfig')
  },

  /**
   * 发送 LLM 聊天请求（非流式）
   */
  chat: (
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<{ success: boolean; content?: string; error?: string }> => {
    return ipcRenderer.invoke('llm:chat', messages, options)
  },

  /**
   * 发送 LLM 聊天请求（流式）
   * 返回一个 Promise，该 Promise 在流完成后才 resolve
   */
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
              onChunk({ content: '', isFinished: true, finishReason: 'error' })
            }
            ipcRenderer.removeListener('llm:streamChunk', handler)
            resolve({ success: false, error: data.error })
          } else {
            if (onChunk) {
              onChunk(data.chunk)
            }

            // 如果已完成，移除监听器并 resolve
            if (data.chunk.isFinished) {
              console.log('[preload] chatStream 完成，requestId:', requestId)
              ipcRenderer.removeListener('llm:streamChunk', handler)
              resolve({ success: true })
            }
          }
        }
      }

      ipcRenderer.on('llm:streamChunk', handler)

      // 发起请求
      ipcRenderer
        .invoke('llm:chatStream', requestId, messages, options)
        .then((result) => {
          console.log('[preload] chatStream invoke 返回:', result)
          if (!result.success) {
            ipcRenderer.removeListener('llm:streamChunk', handler)
            resolve(result)
          }
          // 如果 success，等待流完成（由 handler 处理 resolve）
        })
        .catch((error) => {
          console.error('[preload] chatStream invoke 错误:', error)
          ipcRenderer.removeListener('llm:streamChunk', handler)
          resolve({ success: false, error: String(error) })
        })
    })
  },
}

// ==================== Assistant API ====================

export interface AssistantSummary {
  id: string
  name: string
  systemPrompt: string
  presetQuestions: string[]
  order?: number
  builtinId?: string
  applicableChatTypes?: ('group' | 'private')[]
  supportedLocales?: string[]
}

export interface AssistantConfigFull {
  id: string
  name: string
  systemPrompt: string
  presetQuestions: string[]
  allowedBuiltinTools?: string[]
  customSqlTools?: unknown[]
  version: number
  builtinId?: string
  order?: number
  applicableChatTypes?: ('group' | 'private')[]
  supportedLocales?: string[]
}

export interface BuiltinAssistantInfo {
  id: string
  name: string
  systemPrompt: string
  version: number
  order?: number
  applicableChatTypes?: ('group' | 'private')[]
  supportedLocales?: string[]
  imported: boolean
  hasUpdate: boolean
}

export interface BuiltinSqlToolInfo {
  name: string
  description: string
}

export const assistantApi = {
  getAll: (): Promise<AssistantSummary[]> => {
    return ipcRenderer.invoke('assistant:getAll')
  },

  getConfig: (id: string): Promise<AssistantConfigFull | null> => {
    return ipcRenderer.invoke('assistant:getConfig', id)
  },

  update: (id: string, updates: Partial<AssistantConfigFull>): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('assistant:update', id, updates)
  },

  create: (
    config: Omit<AssistantConfigFull, 'id' | 'version'>
  ): Promise<{ success: boolean; id?: string; error?: string }> => {
    return ipcRenderer.invoke('assistant:create', config)
  },

  delete: (id: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('assistant:delete', id)
  },

  reset: (id: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('assistant:reset', id)
  },

  getBuiltinCatalog: (): Promise<BuiltinAssistantInfo[]> => {
    return ipcRenderer.invoke('assistant:getBuiltinCatalog')
  },

  getBuiltinSqlTools: (): Promise<BuiltinSqlToolInfo[]> => {
    return ipcRenderer.invoke('assistant:getBuiltinSqlTools')
  },

  getBuiltinTsToolNames: (): Promise<string[]> => {
    return ipcRenderer.invoke('assistant:getBuiltinTsToolNames')
  },

  importAssistant: (builtinId: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('assistant:import', builtinId)
  },

  reimportAssistant: (id: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('assistant:reimport', id)
  },
}

// ==================== Skill API ====================

export interface SkillSummary {
  id: string
  name: string
  description: string
  tags: string[]
  chatScope: 'all' | 'group' | 'private'
  tools: string[]
  builtinId?: string
}

export interface SkillConfigFull {
  id: string
  name: string
  description: string
  tags: string[]
  chatScope: 'all' | 'group' | 'private'
  prompt: string
  tools: string[]
  builtinId?: string
}

export interface BuiltinSkillInfo extends SkillSummary {
  imported: boolean
  hasUpdate: boolean
}

export const skillApi = {
  getAll: (): Promise<SkillSummary[]> => {
    return ipcRenderer.invoke('skill:getAll')
  },

  getConfig: (id: string): Promise<SkillConfigFull | null> => {
    return ipcRenderer.invoke('skill:getConfig', id)
  },

  update: (id: string, rawMd: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('skill:update', id, rawMd)
  },

  create: (rawMd: string): Promise<{ success: boolean; id?: string; error?: string }> => {
    return ipcRenderer.invoke('skill:create', rawMd)
  },

  delete: (id: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('skill:delete', id)
  },

  getBuiltinCatalog: (): Promise<BuiltinSkillInfo[]> => {
    return ipcRenderer.invoke('skill:getBuiltinCatalog')
  },

  importSkill: (builtinId: string): Promise<{ success: boolean; id?: string; error?: string }> => {
    return ipcRenderer.invoke('skill:import', builtinId)
  },

  reimportSkill: (id: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('skill:reimport', id)
  },
}

// ==================== Agent API ====================

export const agentApi = {
  /**
   * 执行 Agent 对话（流式）
   * Agent 通过 context.conversationId 从后端 SQLite 读取对话历史
   * @param chatType 聊天类型（'group' | 'private'）
   * @param locale 语言设置（可选，默认 'zh-CN'）
   * @param maxHistoryRounds 最大历史轮数（可选，每轮 = user + assistant = 2 条）
   * @returns 返回 { requestId, promise }，requestId 可用于中止请求
   */
  runStream: (
    userMessage: string,
    context: ToolContext,
    onChunk?: (chunk: AgentStreamChunk) => void,
    chatType?: 'group' | 'private',
    locale?: string,
    maxHistoryRounds?: number,
    assistantId?: string,
    skillId?: string | null,
    enableAutoSkill?: boolean
  ): { requestId: string; promise: Promise<{ success: boolean; result?: AgentResult; error?: string }> } => {
    // 防御性处理：确保传给 IPC 的 context 是“可结构化克隆”的纯对象
    // 避免调用方误传入响应式 Proxy（例如 Pinia/Vue state）导致 invoke 失败
    const sanitizedContext: ToolContext = {
      sessionId: context.sessionId,
      conversationId: context.conversationId,
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

    const promise = new Promise<{ success: boolean; result?: AgentResult; error?: string }>((resolve) => {
      // 监听流式 chunks
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

      // 监听完成事件
      const completeHandler = (
        _event: Electron.IpcRendererEvent,
        data: { requestId: string; result: AgentResult & { error?: string } }
      ) => {
        if (data.requestId === requestId) {
          console.log('[preload] Agent 完成，requestId:', requestId, 'hasError:', !!data.result?.error)
          ipcRenderer.removeListener('agent:streamChunk', chunkHandler)
          ipcRenderer.removeListener('agent:complete', completeHandler)
          // 如果 result 中包含 error，返回失败状态
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
          maxHistoryRounds,
          assistantId,
          skillId,
          enableAutoSkill
        )
        .then((result) => {
          console.log('[preload] Agent invoke 返回:', result)
          if (!result.success) {
            ipcRenderer.removeListener('agent:streamChunk', chunkHandler)
            ipcRenderer.removeListener('agent:complete', completeHandler)
            resolve(result)
          }
          // 如果 success，等待完成（由 completeHandler 处理 resolve）
        })
        .catch((error) => {
          console.error('[preload] Agent invoke 错误:', error)
          ipcRenderer.removeListener('agent:streamChunk', chunkHandler)
          ipcRenderer.removeListener('agent:complete', completeHandler)
          resolve({ success: false, error: String(error) })
        })
    })

    return { requestId, promise }
  },

  /**
   * 中止 Agent 请求
   * @param requestId 请求 ID
   */
  abort: (requestId: string): Promise<{ success: boolean; error?: string }> => {
    console.log('[preload] Agent abort 请求，requestId:', requestId)
    return ipcRenderer.invoke('agent:abort', requestId)
  },
}

// ==================== Embedding API ====================

export const embeddingApi = {
  /**
   * 获取所有 Embedding 配置（展示用）
   */
  getAllConfigs: (): Promise<EmbeddingServiceConfigDisplay[]> => {
    return ipcRenderer.invoke('embedding:getAllConfigs')
  },

  /**
   * 获取单个 Embedding 配置（用于编辑）
   */
  getConfig: (id: string): Promise<EmbeddingServiceConfig | null> => {
    return ipcRenderer.invoke('embedding:getConfig', id)
  },

  /**
   * 获取激活的配置 ID
   */
  getActiveConfigId: (): Promise<string | null> => {
    return ipcRenderer.invoke('embedding:getActiveConfigId')
  },

  /**
   * 检查语义搜索是否启用
   */
  isEnabled: (): Promise<boolean> => {
    return ipcRenderer.invoke('embedding:isEnabled')
  },

  /**
   * 添加 Embedding 配置
   */
  addConfig: (
    config: Omit<EmbeddingServiceConfig, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<{ success: boolean; config?: EmbeddingServiceConfig; error?: string }> => {
    return ipcRenderer.invoke('embedding:addConfig', config)
  },

  /**
   * 更新 Embedding 配置
   */
  updateConfig: (
    id: string,
    updates: Partial<Omit<EmbeddingServiceConfig, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('embedding:updateConfig', id, updates)
  },

  /**
   * 删除 Embedding 配置
   */
  deleteConfig: (id: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('embedding:deleteConfig', id)
  },

  /**
   * 设置激活的配置
   */
  setActiveConfig: (id: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('embedding:setActiveConfig', id)
  },

  /**
   * 验证 Embedding 配置
   */
  validateConfig: (config: EmbeddingServiceConfig): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('embedding:validateConfig', config)
  },

  /**
   * 获取向量存储统计信息
   */
  getVectorStoreStats: (): Promise<{ enabled: boolean; count?: number; sizeBytes?: number }> => {
    return ipcRenderer.invoke('rag:getVectorStoreStats')
  },

  /**
   * 清空向量存储
   */
  clearVectorStore: (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('rag:clearVectorStore')
  },
}
