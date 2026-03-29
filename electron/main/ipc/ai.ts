// electron/main/ipc/ai.ts
import { ipcMain, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as aiConversations from '../ai/conversations'
import * as llm from '../ai/llm'
import * as rag from '../ai/rag'
import { aiLogger, setDebugMode } from '../ai/logger'
import { getLogsDir } from '../paths'
import { Agent, type AgentStreamChunk, type SkillContext } from '../ai/agent'
import { getDefaultGeneralAssistantId } from '../ai/assistant/defaultGeneral'
import { getActiveConfig, buildPiModel } from '../ai/llm'
import * as assistantManager from '../ai/assistant'
import type { AssistantConfig } from '../ai/assistant/types'
import * as skillManager from '../ai/skills'
import {
  completeSimple,
  streamSimple,
  type Message as PiMessage,
  type TextContent as PiTextContent,
} from '@mariozechner/pi-ai'
import { t } from '../i18n'
import type { ToolContext } from '../ai/tools/types'
import { getDefaultRulesForLocale, mergeRulesForLocale } from '../ai/preprocessor/builtin-rules'
import type { IpcContext } from './types'

function toPiSimpleMessages(messages: Array<{ role: string; content: string }>, timestamp: number): PiMessage[] {
  // pi-ai 的 simple API 在类型上要求完整 Message 联合，这里沿用现有轻量消息格式并集中做兼容转换。
  return messages.map((message) => ({
    role: message.role as 'user' | 'assistant',
    content: message.content,
    timestamp,
  })) as unknown as PiMessage[]
}

// ==================== AI Agent 请求追踪 ====================
// 用于跟踪活跃的 Agent 请求，支持中止操作
const activeAgentRequests = new Map<string, AbortController>()

/**
 * 格式化 AI 报错信息，输出更友好的提示
 */
function formatAIError(error: unknown): string {
  const candidates: unknown[] = []
  if (error) {
    candidates.push(error)
  }

  const errorObj = error as {
    lastError?: unknown
    errors?: unknown[]
  }

  if (errorObj?.lastError) {
    candidates.push(errorObj.lastError)
  }

  if (Array.isArray(errorObj?.errors)) {
    candidates.push(...errorObj.errors)
  }

  let rawMessage = ''
  let statusCode: number | undefined
  let retrySeconds: number | undefined

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') {
      if (!rawMessage && typeof candidate === 'string') {
        rawMessage = candidate
      }
      continue
    }

    const record = candidate as Record<string, unknown>
    if (typeof record.statusCode === 'number') {
      statusCode = record.statusCode
    }

    if (!rawMessage && typeof record.message === 'string') {
      rawMessage = record.message
    }

    if (!rawMessage && record.data && typeof record.data === 'object') {
      const data = record.data as { error?: { message?: string } }
      if (data.error?.message) {
        rawMessage = data.error.message
      }
    }

    if (record.responseBody && typeof record.responseBody === 'string') {
      const responseBody = record.responseBody
      try {
        const parsed = JSON.parse(responseBody) as { error?: { message?: string } }
        if (!rawMessage && parsed.error?.message) {
          rawMessage = parsed.error.message
        }
      } catch {
        if (!rawMessage) {
          rawMessage = responseBody
        }
      }
    }

    if (rawMessage) {
      const retryMatch = rawMessage.match(/retry in ([0-9.]+)s/i)
      if (retryMatch) {
        retrySeconds = Math.ceil(Number(retryMatch[1]))
      }
    }
  }

  const fallbackMessage = rawMessage || String(error)
  const lowerMessage = fallbackMessage.toLowerCase()

  if (statusCode === 429 || lowerMessage.includes('quota') || lowerMessage.includes('resource_exhausted')) {
    return retrySeconds
      ? `Gemini quota exhausted, please retry after ${retrySeconds}s or upgrade your quota.`
      : 'Gemini quota exhausted, please retry later or upgrade your quota.'
  }

  if (statusCode === 503 || lowerMessage.includes('overloaded') || lowerMessage.includes('unavailable')) {
    return 'Gemini model is overloaded, please retry later.'
  }

  if (fallbackMessage.length > 300) {
    return `${fallbackMessage.slice(0, 300)}...`
  }

  return fallbackMessage
}

export function registerAIHandlers({ win }: IpcContext): void {
  console.log('[IPC] Registering AI handlers...')

  // 初始化助手管理器（同步内置助手、加载用户助手）
  try {
    assistantManager.initAssistantManager()
    console.log('[IPC] Assistant manager initialized')
  } catch (error) {
    console.error('[IPC] Failed to initialize assistant manager:', error)
  }

  // 初始化技能管理器（扫描用户技能文件）
  try {
    skillManager.initSkillManager()
    console.log('[IPC] Skill manager initialized')
  } catch (error) {
    console.error('[IPC] Failed to initialize skill manager:', error)
  }

  // ==================== Debug 模式 ====================

  ipcMain.on('app:setDebugMode', (_, enabled: boolean) => {
    setDebugMode(enabled)
    aiLogger.info('Config', `Debug mode ${enabled ? 'enabled' : 'disabled'}`)
  })

  // ==================== AI 对话管理 ====================

  /**
   * 创建新的 AI 对话
   * 参数契约与 preload / 数据层保持一致：(sessionId, title?)
   */
  ipcMain.handle(
    'ai:createConversation',
    async (_, sessionId: string, title: string | undefined, assistantId: string) => {
      try {
        return aiConversations.createConversation(sessionId, title, assistantId)
      } catch (error) {
        console.error('Failed to create AI conversation:', error)
        throw error
      }
    }
  )

  /**
   * 获取所有 AI 对话列表
   */
  ipcMain.handle('ai:getConversations', async (_, sessionId: string) => {
    try {
      return aiConversations.getConversations(sessionId)
    } catch (error) {
      console.error('Failed to get AI conversations:', error)
      return []
    }
  })

  /**
   * 打开当前 AI 日志文件并定位到文件
   */
  ipcMain.handle('ai:showLogFile', async () => {
    try {
      // 优先使用当前已存在的日志文件，避免创建新的空日志
      const existingLogPath = aiLogger.getExistingLogPath()
      if (existingLogPath) {
        shell.showItemInFolder(existingLogPath)
        return { success: true, path: existingLogPath }
      }

      const logDir = path.join(getLogsDir(), 'ai')
      if (!fs.existsSync(logDir)) {
        return { success: false, error: 'No AI log files found' }
      }

      const logFiles = fs.readdirSync(logDir).filter((name) => name.startsWith('ai_') && name.endsWith('.log'))

      if (logFiles.length === 0) {
        return { success: false, error: 'No AI log files found' }
      }

      // 选择最近修改的日志文件
      const latestLog = logFiles
        .map((name) => {
          const filePath = path.join(logDir, name)
          const stat = fs.statSync(filePath)
          return { path: filePath, mtimeMs: stat.mtimeMs }
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]

      shell.showItemInFolder(latestLog.path)
      return { success: true, path: latestLog.path }
    } catch (error) {
      console.error('Failed to open AI log file:', error)
      return { success: false, error: String(error) }
    }
  })

  /**
   * 获取单个对话详情
   */
  ipcMain.handle('ai:getConversation', async (_, conversationId: string) => {
    try {
      return aiConversations.getConversation(conversationId)
    } catch (error) {
      console.error('Failed to get AI conversation details:', error)
      return null
    }
  })

  /**
   * 更新 AI 对话标题
   */
  ipcMain.handle('ai:updateConversationTitle', async (_, conversationId: string, title: string) => {
    try {
      return aiConversations.updateConversationTitle(conversationId, title)
    } catch (error) {
      console.error('Failed to update AI conversation title:', error)
      return false
    }
  })

  /**
   * 删除 AI 对话
   */
  ipcMain.handle('ai:deleteConversation', async (_, conversationId: string) => {
    try {
      return aiConversations.deleteConversation(conversationId)
    } catch (error) {
      console.error('Failed to delete AI conversation:', error)
      return false
    }
  })

  /**
   * 添加 AI 消息
   */
  ipcMain.handle(
    'ai:addMessage',
    async (
      _,
      conversationId: string,
      role: 'user' | 'assistant',
      content: string,
      dataKeywords?: string[],
      dataMessageCount?: number,
      contentBlocks?: aiConversations.ContentBlock[]
    ) => {
      try {
        return aiConversations.addMessage(conversationId, role, content, dataKeywords, dataMessageCount, contentBlocks)
      } catch (error) {
        console.error('Failed to add AI message:', error)
        throw error
      }
    }
  )

  /**
   * 获取 AI 对话的所有消息
   */
  ipcMain.handle('ai:getMessages', async (_, conversationId: string) => {
    try {
      return aiConversations.getMessages(conversationId)
    } catch (error) {
      console.error('Failed to get AI messages:', error)
      return []
    }
  })

  /**
   * 删除 AI 消息
   */
  ipcMain.handle('ai:deleteMessage', async (_, messageId: string) => {
    try {
      return aiConversations.deleteMessage(messageId)
    } catch (error) {
      console.error('Failed to delete AI message:', error)
      return false
    }
  })

  // ==================== 脱敏规则 ====================

  ipcMain.handle('ai:getDefaultDesensitizeRules', (_, locale: string) => {
    return getDefaultRulesForLocale(locale)
  })

  ipcMain.handle('ai:mergeDesensitizeRules', (_, existingRules: unknown[], locale: string) => {
    return mergeRulesForLocale(existingRules as any[], locale)
  })

  // ==================== LLM 服务（多配置管理）====================

  /**
   * 获取所有支持的 LLM 提供商
   */
  ipcMain.handle('llm:getProviders', async () => {
    return llm.PROVIDERS
  })

  /**
   * 获取所有配置列表
   */
  ipcMain.handle('llm:getAllConfigs', async () => {
    const configs = llm.getAllConfigs()
    // 返回 API Key
    return configs.map((c) => ({
      ...c,
      apiKeySet: !!c.apiKey,
    }))
  })

  /**
   * 获取当前激活的配置 ID
   */
  ipcMain.handle('llm:getActiveConfigId', async () => {
    const config = llm.getActiveConfig()
    return config?.id || null
  })

  /**
   * 添加新配置
   */
  ipcMain.handle(
    'llm:addConfig',
    async (
      _,
      config: {
        name: string
        provider: llm.LLMProvider
        apiKey: string
        model?: string
        baseUrl?: string
        maxTokens?: number
      }
    ) => {
      try {
        const result = llm.addConfig(config)
        if (result.success && result.config) {
          return {
            success: true,
            config: {
              ...result.config,
              apiKeySet: !!result.config.apiKey,
            },
          }
        }
        return result
      } catch (error) {
        console.error('Failed to add LLM config:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  /**
   * 更新配置
   */
  ipcMain.handle(
    'llm:updateConfig',
    async (
      _,
      id: string,
      updates: {
        name?: string
        provider?: llm.LLMProvider
        apiKey?: string
        model?: string
        baseUrl?: string
        maxTokens?: number
      }
    ) => {
      try {
        // 如果 apiKey 为空字符串，表示不更新 API Key
        const cleanUpdates = { ...updates }
        if (cleanUpdates.apiKey === '') {
          delete cleanUpdates.apiKey
        }

        return llm.updateConfig(id, cleanUpdates)
      } catch (error) {
        console.error('Failed to update LLM config:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  /**
   * 删除配置
   */
  ipcMain.handle('llm:deleteConfig', async (_, id?: string) => {
    try {
      // 如果没有传 id，删除当前激活的配置
      if (!id) {
        const activeConfig = llm.getActiveConfig()
        if (activeConfig) {
          return llm.deleteConfig(activeConfig.id)
        }
        return { success: false, error: t('llm.noActiveConfig') }
      }
      return llm.deleteConfig(id)
    } catch (error) {
      console.error('Failed to delete LLM config:', error)
      return { success: false, error: String(error) }
    }
  })

  /**
   * 设置激活的配置
   */
  ipcMain.handle('llm:setActiveConfig', async (_, id: string) => {
    try {
      return llm.setActiveConfig(id)
    } catch (error) {
      console.error('Failed to set active config:', error)
      return { success: false, error: String(error) }
    }
  })

  /**
   * 验证 API Key（支持自定义 baseUrl 和 model）
   * 返回对象格式：{ success: boolean, error?: string }
   */
  ipcMain.handle(
    'llm:validateApiKey',
    async (_, provider: llm.LLMProvider, apiKey: string, baseUrl?: string, model?: string) => {
      console.log('[LLM:validateApiKey] Validating:', { provider, baseUrl, model, apiKeyLength: apiKey?.length })
      try {
        const result = await llm.validateApiKey(provider, apiKey, baseUrl, model)
        console.log('[LLM:validateApiKey] Result:', result)
        return result
      } catch (error) {
        console.error('[LLM:validateApiKey] Validation failed:', error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        return { success: false, error: errorMessage }
      }
    }
  )

  /**
   * 检查是否已配置 LLM（是否有激活的配置）
   */
  ipcMain.handle('llm:hasConfig', async () => {
    return llm.hasActiveConfig()
  })

  // ==================== LLM 直接调用 API（SQLLab 等非 Agent 场景使用） ====================

  /**
   * 非流式 LLM 调用
   */
  ipcMain.handle(
    'llm:chat',
    async (
      _,
      messages: Array<{ role: string; content: string }>,
      options?: { temperature?: number; maxTokens?: number }
    ) => {
      try {
        const activeConfig = getActiveConfig()
        if (!activeConfig) {
          return { success: false, error: t('llm.notConfigured') }
        }
        const piModel = buildPiModel(activeConfig)
        const now = Date.now()
        const systemMsg = messages.find((m) => m.role === 'system')
        const nonSystemMsgs = messages.filter((m) => m.role !== 'system')

        const result = await completeSimple(
          piModel,
          {
            systemPrompt: systemMsg?.content,
            messages: toPiSimpleMessages(nonSystemMsgs, now),
          },
          {
            apiKey: activeConfig.apiKey,
            temperature: options?.temperature,
            maxTokens: options?.maxTokens,
          }
        )

        const content = result.content
          .filter((item): item is PiTextContent => item.type === 'text')
          .map((item) => item.text)
          .join('')

        return { success: true, content }
      } catch (error) {
        aiLogger.error('IPC', 'llm:chat error', { error: String(error) })
        return { success: false, error: String(error) }
      }
    }
  )

  /**
   * 流式 LLM 调用（SQLLab AI 生成 / 结果总结等场景使用）
   */
  ipcMain.handle(
    'llm:chatStream',
    async (
      _,
      requestId: string,
      messages: Array<{ role: string; content: string }>,
      options?: { temperature?: number; maxTokens?: number }
    ) => {
      try {
        const activeConfig = getActiveConfig()
        if (!activeConfig) {
          return { success: false, error: t('llm.notConfigured') }
        }
        const piModel = buildPiModel(activeConfig)
        const now = Date.now()
        const systemMsg = messages.find((m) => m.role === 'system')
        const nonSystemMsgs = messages.filter((m) => m.role !== 'system')

        const eventStream = streamSimple(
          piModel,
          {
            systemPrompt: systemMsg?.content,
            messages: toPiSimpleMessages(nonSystemMsgs, now),
          },
          {
            apiKey: activeConfig.apiKey,
            temperature: options?.temperature,
            maxTokens: options?.maxTokens,
          }
        )

        // 异步消费流，通过事件发送 chunks
        ;(async () => {
          let hasTerminalChunk = false
          try {
            for await (const event of eventStream) {
              if (event.type === 'text_delta') {
                win.webContents.send('llm:streamChunk', {
                  requestId,
                  chunk: { content: event.delta, isFinished: false },
                })
                continue
              }

              if (event.type === 'done') {
                hasTerminalChunk = true
                win.webContents.send('llm:streamChunk', {
                  requestId,
                  chunk: { content: '', isFinished: true, finishReason: event.reason === 'length' ? 'length' : 'stop' },
                })
                return
              }

              if (event.type === 'error') {
                hasTerminalChunk = true
                const errorMsg = event.error?.errorMessage || formatAIError(event.error) || 'Unknown LLM error'
                aiLogger.error('IPC', 'llm:chatStream LLM error', { requestId, error: errorMsg })
                win.webContents.send('llm:streamChunk', {
                  requestId,
                  error: errorMsg,
                  chunk: { content: '', isFinished: true, finishReason: 'error' },
                })
                return
              }
            }

            if (!hasTerminalChunk) {
              win.webContents.send('llm:streamChunk', {
                requestId,
                chunk: { content: '', isFinished: true, finishReason: 'stop' },
              })
            }
          } catch (error) {
            if (!hasTerminalChunk) {
              const friendlyError = formatAIError(error)
              aiLogger.error('IPC', 'llm:chatStream stream error', { requestId, error: String(error) })
              win.webContents.send('llm:streamChunk', {
                requestId,
                error: friendlyError,
                chunk: { content: '', isFinished: true, finishReason: 'error' },
              })
            }
          }
        })()

        return { success: true }
      } catch (error) {
        aiLogger.error('IPC', 'llm:chatStream error', { error: String(error) })
        return { success: false, error: String(error) }
      }
    }
  )

  // ==================== 助手管理 API ====================

  ipcMain.handle('assistant:getAll', async () => {
    try {
      return assistantManager.getAllAssistants()
    } catch (error) {
      console.error('Failed to get assistants:', error)
      return []
    }
  })

  ipcMain.handle('assistant:getConfig', async (_, id: string) => {
    try {
      return assistantManager.getAssistantConfig(id)
    } catch (error) {
      console.error('Failed to get assistant config:', error)
      return null
    }
  })

  ipcMain.handle('assistant:update', async (_, id: string, updates: Partial<AssistantConfig>) => {
    try {
      return assistantManager.updateAssistant(id, updates)
    } catch (error) {
      console.error('Failed to update assistant:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('assistant:create', async (_, config: Omit<AssistantConfig, 'id' | 'version'>) => {
    try {
      return assistantManager.createAssistant(config)
    } catch (error) {
      console.error('Failed to create assistant:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('assistant:delete', async (_, id: string) => {
    try {
      return assistantManager.deleteAssistant(id)
    } catch (error) {
      console.error('Failed to delete assistant:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('assistant:reset', async (_, id: string) => {
    try {
      return assistantManager.resetAssistant(id)
    } catch (error) {
      console.error('Failed to reset assistant:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('assistant:getBuiltinTsToolNames', async () => {
    try {
      return assistantManager.getBuiltinTsToolNames()
    } catch (error) {
      console.error('Failed to get builtin ts tool names:', error)
      return []
    }
  })

  ipcMain.handle('assistant:getBuiltinCatalog', async () => {
    try {
      return assistantManager.getBuiltinCatalog()
    } catch (error) {
      console.error('Failed to get builtin catalog:', error)
      return []
    }
  })

  ipcMain.handle('assistant:import', async (_, builtinId: string) => {
    try {
      return assistantManager.importAssistant(builtinId)
    } catch (error) {
      console.error('Failed to import assistant:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('assistant:reimport', async (_, id: string) => {
    try {
      return assistantManager.reimportAssistant(id)
    } catch (error) {
      console.error('Failed to reimport assistant:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('assistant:importFromMd', async (_, rawMd: string) => {
    try {
      return assistantManager.importAssistantFromMd(rawMd)
    } catch (error) {
      console.error('Failed to import assistant from markdown:', error)
      return { success: false, error: String(error) }
    }
  })

  // ==================== 技能管理 API ====================

  ipcMain.handle('skill:getAll', async () => {
    try {
      return skillManager.getAllSkills()
    } catch (error) {
      console.error('Failed to get skills:', error)
      return []
    }
  })

  ipcMain.handle('skill:getConfig', async (_, id: string) => {
    try {
      return skillManager.getSkillConfig(id)
    } catch (error) {
      console.error('Failed to get skill config:', error)
      return null
    }
  })

  ipcMain.handle('skill:update', async (_, id: string, rawMd: string) => {
    try {
      return skillManager.updateSkill(id, rawMd)
    } catch (error) {
      console.error('Failed to update skill:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('skill:create', async (_, rawMd: string) => {
    try {
      return skillManager.createSkill(rawMd)
    } catch (error) {
      console.error('Failed to create skill:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('skill:delete', async (_, id: string) => {
    try {
      return skillManager.deleteSkill(id)
    } catch (error) {
      console.error('Failed to delete skill:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('skill:getBuiltinCatalog', async () => {
    try {
      return skillManager.getBuiltinCatalog()
    } catch (error) {
      console.error('Failed to get builtin catalog:', error)
      return []
    }
  })

  ipcMain.handle('skill:import', async (_, builtinId: string) => {
    try {
      return skillManager.importSkill(builtinId)
    } catch (error) {
      console.error('Failed to import skill:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('skill:reimport', async (_, id: string) => {
    try {
      return skillManager.reimportSkill(id)
    } catch (error) {
      console.error('Failed to reimport skill:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('skill:importFromMd', async (_, rawMd: string) => {
    try {
      return skillManager.importSkillFromMd(rawMd)
    } catch (error) {
      console.error('Failed to import skill from markdown:', error)
      return { success: false, error: String(error) }
    }
  })

  // ==================== AI Agent API ====================

  /**
   * 执行 Agent 对话（流式）
   * Agent 会自动调用工具并返回最终结果
   * Agent 通过 context.conversationId 从 SQLite 读取对话历史（数据流倒置）
   * @param chatType 聊天类型（'group' | 'private'）
   * @param locale 语言设置（可选，默认 'zh-CN'）
   * @param maxHistoryRounds 前端用户配置的最大历史轮数（可选，每轮 = user + assistant = 2 条）
   * @param assistantId 助手 ID（可选，传入时从 AssistantManager 获取配置）
   */
  ipcMain.handle(
    'agent:runStream',
    async (
      _,
      requestId: string,
      userMessage: string,
      context: ToolContext,
      chatType?: 'group' | 'private',
      locale?: string,
      maxHistoryRounds?: number,
      assistantId?: string,
      skillId?: string | null,
      enableAutoSkill?: boolean
    ) => {
      aiLogger.info('IPC', `Agent stream request received: ${requestId}`, {
        userMessage: userMessage.slice(0, 100),
        sessionId: context.sessionId,
        conversationId: context.conversationId,
        chatType: chatType ?? 'group',
        assistantId: assistantId ?? '(none)',
        skillId: skillId ?? '(none)',
        enableAutoSkill: enableAutoSkill ?? false,
      })

      try {
        const abortController = new AbortController()
        activeAgentRequests.set(requestId, abortController)

        const activeAIConfig = getActiveConfig()
        if (!activeAIConfig) {
          return { success: false, error: t('llm.notConfigured') }
        }
        const piModel = buildPiModel(activeAIConfig)

        const contextHistoryLimit = maxHistoryRounds ? maxHistoryRounds * 2 : undefined

        const pp = context.preprocessConfig
        aiLogger.info('IPC', `Agent context: ${requestId}`, {
          model: activeAIConfig.model,
          provider: activeAIConfig.provider,
          baseUrl: activeAIConfig.baseUrl || '(default)',
          maxHistoryRounds: maxHistoryRounds ?? '(default)',
          maxMessagesLimit: context.maxMessagesLimit,
          hasTimeFilter: !!context.timeFilter,
          mentionedMembersCount: context.mentionedMembers?.length ?? 0,
          preprocess: pp
            ? {
                dataCleaning: pp.dataCleaning ?? true,
                mergeConsecutive: pp.mergeConsecutive,
                denoise: pp.denoise,
                desensitize: pp.desensitize,
                anonymizeNames: pp.anonymizeNames,
              }
            : '(disabled)',
        })

        // 提示词系统已退场，主流程统一从助手配置获取 systemPrompt。
        const defaultAssistantId = getDefaultGeneralAssistantId(locale)
        let resolvedAssistantId = assistantId || defaultAssistantId
        let assistantConfig: AssistantConfig | undefined =
          assistantManager.getAssistantConfig(resolvedAssistantId) ?? undefined
        if (!assistantConfig && resolvedAssistantId !== defaultAssistantId) {
          aiLogger.warn('IPC', `Assistant not found: ${resolvedAssistantId}, falling back to ${defaultAssistantId}`, {
            requestedAssistantId: assistantId ?? null,
            locale: locale ?? null,
          })
          resolvedAssistantId = defaultAssistantId
          assistantConfig = assistantManager.getAssistantConfig(defaultAssistantId) ?? undefined
        }

        // 构建技能上下文
        let skillCtx: SkillContext | undefined
        if (skillId) {
          const skillDef = skillManager.getSkillConfig(skillId) ?? undefined
          if (skillDef) {
            skillCtx = { skillDef }
          } else {
            aiLogger.warn('IPC', `Skill not found: ${skillId}`)
          }
        } else if (enableAutoSkill) {
          const effectiveChatType = chatType ?? 'group'
          const allowedTools = assistantConfig?.allowedBuiltinTools
          const menu = skillManager.getSkillMenu(effectiveChatType, allowedTools)
          if (menu) {
            skillCtx = { skillMenu: menu }
          }
        }

        const agent = new Agent(
          context,
          piModel,
          activeAIConfig.apiKey,
          { abortSignal: abortController.signal, contextHistoryLimit },
          chatType ?? 'group',
          locale ?? 'zh-CN',
          assistantConfig,
          skillCtx
        )

        // 异步执行，通过事件发送流式数据
        ;(async () => {
          try {
            const result = await agent.executeStream(userMessage, (chunk: AgentStreamChunk) => {
              // 如果已中止，不再发送
              if (abortController.signal.aborted) {
                return
              }
              if (chunk.type === 'tool_start') {
                aiLogger.info('IPC', `Tool call: ${chunk.toolName}`, chunk.toolParams)
              }
              win.webContents.send('agent:streamChunk', { requestId, chunk })
            })

            if (abortController.signal.aborted) {
              aiLogger.info('IPC', `Agent aborted: ${requestId}`)
              win.webContents.send('agent:complete', {
                requestId,
                result: {
                  content: result.content,
                  toolsUsed: result.toolsUsed,
                  toolRounds: result.toolRounds,
                  totalUsage: result.totalUsage,
                  aborted: true,
                },
              })
              return
            }

            // 发送完成信息
            win.webContents.send('agent:complete', {
              requestId,
              result: {
                content: result.content,
                toolsUsed: result.toolsUsed,
                toolRounds: result.toolRounds,
                totalUsage: result.totalUsage,
              },
            })

            aiLogger.info('IPC', `Agent execution completed: ${requestId}`, {
              toolsUsed: result.toolsUsed,
              toolRounds: result.toolRounds,
              contentLength: result.content.length,
              totalUsage: result.totalUsage,
            })
          } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
              aiLogger.info('IPC', `Agent request aborted (error): ${requestId}`)
              win.webContents.send('agent:complete', {
                requestId,
                result: { content: '', toolsUsed: [], toolRounds: 0, aborted: true },
              })
              return
            }
            const friendlyError = formatAIError(error)
            aiLogger.error('IPC', `Agent execution error: ${requestId}`, {
              error: String(error),
              friendlyError,
            })
            // 发送错误 chunk
            win.webContents.send('agent:streamChunk', {
              requestId,
              chunk: { type: 'error', error: friendlyError, isFinished: true },
            })
            // 发送完成事件（带错误信息），确保前端 promise 能 resolve
            win.webContents.send('agent:complete', {
              requestId,
              result: {
                content: '',
                toolsUsed: [],
                toolRounds: 0,
                totalUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                error: friendlyError,
              },
            })
          } finally {
            // 清理请求追踪
            activeAgentRequests.delete(requestId)
          }
        })()

        return { success: true }
      } catch (error) {
        aiLogger.error('IPC', `Failed to create Agent request: ${requestId}`, { error: String(error) })
        return { success: false, error: String(error) }
      }
    }
  )

  /**
   * 中止 Agent 请求
   */
  ipcMain.handle('agent:abort', async (_, requestId: string) => {
    aiLogger.info('IPC', `Abort request received: ${requestId}`)

    const abortController = activeAgentRequests.get(requestId)
    if (abortController) {
      abortController.abort()
      activeAgentRequests.delete(requestId)
      aiLogger.info('IPC', `Agent request aborted: ${requestId}`)
      return { success: true }
    } else {
      aiLogger.warn('IPC', `Agent request not found: ${requestId}`)
      return { success: false, error: 'Request not found' }
    }
  })

  // ==================== Embedding 多配置管理 ====================

  /**
   * 获取所有 Embedding 配置（展示用，隐藏 apiKey）
   */
  ipcMain.handle('embedding:getAllConfigs', async () => {
    try {
      const configs = rag.getAllEmbeddingConfigs()
      // 隐藏敏感信息
      return configs.map((c) => ({
        ...c,
        apiKey: undefined,
        apiKeySet: !!c.apiKey,
      }))
    } catch (error) {
      aiLogger.error('IPC', 'Failed to get Embedding configs', error)
      return []
    }
  })

  /**
   * 获取单个 Embedding 配置（用于编辑，包含完整信息）
   */
  ipcMain.handle('embedding:getConfig', async (_, id: string) => {
    try {
      return rag.getEmbeddingConfigById(id)
    } catch (error) {
      aiLogger.error('IPC', 'Failed to get Embedding config', error)
      return null
    }
  })

  /**
   * 获取激活的 Embedding 配置 ID
   */
  ipcMain.handle('embedding:getActiveConfigId', async () => {
    try {
      return rag.getActiveEmbeddingConfigId()
    } catch (error) {
      return null
    }
  })

  /**
   * 检查语义搜索是否启用
   */
  ipcMain.handle('embedding:isEnabled', async () => {
    try {
      return rag.isEmbeddingEnabled()
    } catch (error) {
      return false
    }
  })

  /**
   * 添加 Embedding 配置
   */
  ipcMain.handle(
    'embedding:addConfig',
    async (_, config: Omit<rag.EmbeddingServiceConfig, 'id' | 'createdAt' | 'updatedAt'>) => {
      try {
        aiLogger.info('IPC', 'Adding Embedding config', { name: config.name, model: config.model })
        const result = rag.addEmbeddingConfig(config)
        if (result.success) {
          await rag.resetEmbeddingService()
        }
        return result
      } catch (error) {
        aiLogger.error('IPC', 'Failed to add Embedding config', error)
        return { success: false, error: String(error) }
      }
    }
  )

  /**
   * 更新 Embedding 配置
   */
  ipcMain.handle(
    'embedding:updateConfig',
    async (_, id: string, updates: Partial<Omit<rag.EmbeddingServiceConfig, 'id' | 'createdAt' | 'updatedAt'>>) => {
      try {
        aiLogger.info('IPC', 'Updating Embedding config', { id })
        const result = rag.updateEmbeddingConfig(id, updates)
        if (result.success) {
          await rag.resetEmbeddingService()
        }
        return result
      } catch (error) {
        aiLogger.error('IPC', 'Failed to update Embedding config', error)
        return { success: false, error: String(error) }
      }
    }
  )

  /**
   * 删除 Embedding 配置
   */
  ipcMain.handle('embedding:deleteConfig', async (_, id: string) => {
    try {
      aiLogger.info('IPC', 'Deleting Embedding config', { id })
      const result = rag.deleteEmbeddingConfig(id)
      if (result.success) {
        await rag.resetEmbeddingService()
      }
      return result
    } catch (error) {
      aiLogger.error('IPC', 'Failed to delete Embedding config', error)
      return { success: false, error: String(error) }
    }
  })

  /**
   * 设置激活的 Embedding 配置
   */
  ipcMain.handle('embedding:setActiveConfig', async (_, id: string) => {
    try {
      aiLogger.info('IPC', 'Setting active Embedding config', { id })
      const result = rag.setActiveEmbeddingConfig(id)
      if (result.success) {
        await rag.resetEmbeddingService()
      }
      return result
    } catch (error) {
      aiLogger.error('IPC', 'Failed to set active Embedding config', error)
      return { success: false, error: String(error) }
    }
  })

  /**
   * 验证 Embedding 配置
   */
  ipcMain.handle('embedding:validateConfig', async (_, config: rag.EmbeddingServiceConfig) => {
    try {
      return await rag.validateEmbeddingConfig(config)
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // ==================== 向量存储管理 ====================

  /**
   * 获取向量存储统计信息
   */
  ipcMain.handle('rag:getVectorStoreStats', async () => {
    try {
      return await rag.getVectorStoreStats()
    } catch (error) {
      console.error('Failed to get vector store stats:', error)
      return { enabled: false, error: String(error) }
    }
  })

  /**
   * 清空向量存储
   */
  ipcMain.handle('rag:clearVectorStore', async () => {
    try {
      const store = await rag.getVectorStore()
      if (store) {
        await store.clear()
        return { success: true }
      }
      return { success: false, error: 'Vector store not enabled' }
    } catch (error) {
      console.error('Failed to clear vector store:', error)
      return { success: false, error: String(error) }
    }
  })
}
