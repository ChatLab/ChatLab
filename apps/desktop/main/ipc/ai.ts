// electron/main/ipc/ai.ts
import { ipcMain, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as llm from '../ai/llm'
import { aiLogger, setDebugMode } from '../ai/logger'
import { serializeError } from '../ai/serialize-error'
import { getLogsDir } from '../paths'
import * as workerManager from '../worker/workerManager'
import { Agent, type AgentStreamChunk, type SkillContext } from '../ai/agent'
import { getDefaultGeneralAssistantId } from '../ai/assistant/defaultGeneral'
import { getDefaultAssistantConfig, buildPiModel, findModelDefinition } from '../ai/llm'
import type { AIServiceConfig } from '../ai/llm/types'
import { countMessagesTokens } from '@openchatlab/node-runtime'
import { stripAvatarFields } from '@openchatlab/core'
import * as assistantManager from '../ai/assistant'
import type { AssistantConfig } from '../ai/assistant/types'
import * as skillManager from '../ai/skills'
import {
  checkAndCompress,
  createCompressionLlmAdapter,
  type CompressionConfig,
  type CompressionLlmAdapter,
  completeSimple,
  runSimpleLlmStream,
  formatAIError,
  type PiMessage,
  type PiTextContent,
} from '@openchatlab/node-runtime'
import { getManager as getConversationManager } from '../ai/conversations'
import { t } from '../i18n'
import type { ToolContext } from '../ai/tools/types'
import { TOOL_REGISTRY } from '../ai/tools/definitions'
import { getDefaultRulesForLocale, mergeRulesForLocale } from '@openchatlab/node-runtime'
import type { IpcContext } from './types'

const DEFAULT_CONTEXT_WINDOW = 128000

const compressionLogger = {
  info: (cat: string, msg: string, extra?: Record<string, unknown>) => aiLogger.info(cat, msg, extra),
  warn: (cat: string, msg: string, extra?: Record<string, unknown>) => aiLogger.warn(cat, msg, extra),
  error: (cat: string, msg: string, extra?: Record<string, unknown>) => aiLogger.error(cat, msg, extra),
}

function buildCompressionAdapter(activeAIConfig: AIServiceConfig, onCompressing?: () => void): CompressionLlmAdapter {
  const modelDef = findModelDefinition(activeAIConfig.provider, activeAIConfig.model || '')
  return createCompressionLlmAdapter({
    piModel: buildPiModel(activeAIConfig),
    apiKey: activeAIConfig.apiKey,
    contextWindow: modelDef?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    onCompressing,
    onError: (error) => aiLogger.warn('Compression', 'LLM compression attempt failed', { error: String(error) }),
  })
}

function toPiSimpleMessages(messages: Array<{ role: string; content: string }>, timestamp: number): PiMessage[] {
  return messages.map((message) => ({
    role: message.role as 'user' | 'assistant',
    content: message.content,
    timestamp,
  })) as unknown as PiMessage[]
}

// ==================== AI Agent 请求追踪 ====================
const activeAgentRequests = new Map<string, AbortController>()

function resolveProviderName(provider?: llm.LLMProvider): string {
  if (provider === 'openai-compatible') return t('llm.genericProviderName')
  return provider ? llm.getProviderInfo(provider)?.name || provider : t('llm.genericProviderName')
}

export function registerAIHandlers({ win }: IpcContext): void {
  console.log('[IPC] Registering AI handlers...')

  try {
    assistantManager.initAssistantManager()
    console.log('[IPC] Assistant manager initialized')
  } catch (error) {
    console.error('[IPC] Failed to initialize assistant manager:', error)
  }

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

  // ==================== AI 日志 ====================

  ipcMain.handle('ai:showLogFile', async () => {
    try {
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

  // ==================== 脱敏规则 ====================

  ipcMain.handle('ai:getDefaultDesensitizeRules', (_, locale: string) => {
    return getDefaultRulesForLocale(locale)
  })

  ipcMain.handle('ai:mergeDesensitizeRules', (_, existingRules: unknown[], locale: string) => {
    return mergeRulesForLocale(existingRules as any[], locale)
  })

  // ==================== LLM 直接调用 API（SQLLab 等非 Agent 场景） ====================

  ipcMain.handle(
    'llm:chat',
    async (
      _,
      messages: Array<{ role: string; content: string }>,
      options?: { temperature?: number; maxTokens?: number }
    ) => {
      try {
        const activeConfig = getDefaultAssistantConfig()
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

  ipcMain.handle(
    'llm:chatStream',
    async (
      _,
      requestId: string,
      messages: Array<{ role: string; content: string }>,
      options?: { temperature?: number; maxTokens?: number }
    ) => {
      try {
        const activeConfig = getDefaultAssistantConfig()
        if (!activeConfig) {
          return { success: false, error: t('llm.notConfigured') }
        }
        const piModel = buildPiModel(activeConfig)

        ;(async () => {
          await runSimpleLlmStream({
            messages,
            apiKey: activeConfig.apiKey,
            piModel,
            temperature: options?.temperature,
            maxTokens: options?.maxTokens,
            onChunk: (chunk) => {
              if (chunk.error) {
                win.webContents.send('llm:streamChunk', { requestId, error: chunk.error, chunk })
              } else {
                win.webContents.send('llm:streamChunk', { requestId, chunk })
              }
            },
          })
        })()

        return { success: true }
      } catch (error) {
        aiLogger.error('IPC', 'llm:chatStream error', { error: String(error) })
        return { success: false, error: String(error) }
      }
    }
  )

  // ==================== 工具测试 API ====================

  const activeToolTests = new Map<string, AbortController>()

  ipcMain.handle('ai:getToolCatalog', async () => {
    try {
      return TOOL_REGISTRY.map((entry) => {
        const dummyContext: ToolContext = { sessionId: '__catalog__' }
        const tool = entry.factory(dummyContext)
        const descKey = `ai.tools.${entry.name}.desc`
        const translated = t(descKey)
        return {
          name: entry.name,
          category: entry.category,
          description: translated !== descKey ? translated : (tool.description ?? ''),
          parameters: tool.parameters ?? {},
        }
      })
    } catch (error) {
      console.error('Failed to get tool catalog:', error)
      return []
    }
  })

  ipcMain.handle(
    'ai:executeTool',
    async (_, testId: string, toolName: string, params: Record<string, unknown>, sessionId: string) => {
      const MAX_RESULT_CHARS = 500_000
      const abortController = new AbortController()
      activeToolTests.set(testId, abortController)

      try {
        const entry = TOOL_REGISTRY.find((e) => e.name === toolName)
        if (!entry) {
          return { success: false, error: `Tool not found: ${toolName}` }
        }

        const context: ToolContext = { sessionId }
        const tool = entry.factory(context)
        const startTime = Date.now()
        const result = await tool.execute(`test_${Date.now()}`, params)
        const elapsed = Date.now() - startTime

        if (abortController.signal.aborted) {
          return { success: false, error: 'cancelled' }
        }

        let details = result.details as Record<string, unknown> | undefined
        let truncated = false

        if (details) {
          stripAvatarFields(details)
          const raw = JSON.stringify(details)
          if (raw.length > MAX_RESULT_CHARS) {
            truncated = true
            details = { _truncated: true, _originalSize: raw.length, _preview: raw.slice(0, MAX_RESULT_CHARS) }
          }
        }

        return {
          success: true,
          elapsed,
          content: result.content,
          details,
          truncated,
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          return { success: false, error: 'cancelled' }
        }
        console.error(`Failed to execute tool ${toolName}:`, error)
        return { success: false, error: String(error) }
      } finally {
        activeToolTests.delete(testId)
      }
    }
  )

  ipcMain.handle('ai:cancelToolTest', async (_, testId: string) => {
    const controller = activeToolTests.get(testId)
    if (controller) {
      controller.abort()
      activeToolTests.delete(testId)
      return { success: true }
    }
    return { success: false }
  })

  // ==================== AI Agent API ====================

  ipcMain.handle(
    'agent:runStream',
    async (
      _,
      requestId: string,
      userMessage: string,
      context: ToolContext,
      chatType?: 'group' | 'private',
      locale?: string,
      assistantId?: string,
      skillId?: string | null,
      enableAutoSkill?: boolean,
      compressionConfig?: CompressionConfig,
      thinkingLevel?: string
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

        const activeAIConfig = getDefaultAssistantConfig()
        if (!activeAIConfig) {
          return { success: false, error: t('llm.notConfigured') }
        }
        const piModel = buildPiModel(activeAIConfig)

        if (compressionConfig?.enabled && context.conversationId && context.historyLeafMessageId === undefined) {
          try {
            const tempAssistantConfig = assistantId
              ? (assistantManager.getAssistantConfig(assistantId) ?? undefined)
              : undefined
            const systemPromptForCompression = tempAssistantConfig?.systemPrompt || ''

            const compressionResult = await checkAndCompress(
              context.conversationId,
              compressionConfig,
              systemPromptForCompression,
              buildCompressionAdapter(activeAIConfig, () => {
                win.webContents.send('agent:streamChunk', {
                  requestId,
                  chunk: {
                    type: 'status',
                    status: {
                      phase: 'compressing',
                      round: 0,
                      toolsUsed: 0,
                      contextTokens: 0,
                      totalUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                      updatedAt: Date.now(),
                    } satisfies import('@electron/shared/types').AgentRuntimeStatus,
                  },
                })
              }),
              getConversationManager(),
              compressionLogger
            )

            aiLogger.info('IPC', `Compression result for ${requestId}`, compressionResult)

            if (compressionResult.compressed && compressionResult.summaryContent) {
              win.webContents.send('agent:streamChunk', {
                requestId,
                chunk: {
                  type: 'compression_done',
                  compressionResult: {
                    summaryContent: compressionResult.summaryContent,
                    tokensBefore: compressionResult.tokensBefore ?? 0,
                    tokensAfter: compressionResult.tokensAfter ?? 0,
                    timestamp: Date.now(),
                  },
                },
              })
            }
          } catch (error) {
            aiLogger.error('IPC', `Compression failed for ${requestId}, continuing without compression`, {
              error: String(error),
            })
          }
        } else if (compressionConfig?.enabled && context.historyLeafMessageId !== undefined) {
          aiLogger.info('IPC', `Skipping compression for edited branch request: ${requestId}`, {
            conversationId: context.conversationId,
            historyLeafMessageId: context.historyLeafMessageId,
          })
        }

        const pp = context.preprocessConfig
        aiLogger.info('IPC', `Agent context: ${requestId}`, {
          model: activeAIConfig.model,
          provider: activeAIConfig.provider,
          baseUrl: activeAIConfig.baseUrl || '(default)',
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

        const maxToolResultPercent = compressionConfig?.maxToolResultPercent ?? 50
        const modelDef = llm.findModelDefinition(activeAIConfig.provider, activeAIConfig.model || '')
        const resolvedContextWindow = modelDef?.contextWindow || 128000
        const maxToolResultTokens = Math.floor(resolvedContextWindow * (maxToolResultPercent / 100))
        let dataSnapshot: ToolContext['dataSnapshot'] | undefined = context.dataSnapshot
        try {
          const overview = await workerManager.getChatOverview(context.sessionId, 5)
          if (overview) {
            dataSnapshot = {
              name: overview.name,
              platform: overview.platform,
              type: overview.type,
              totalMessages: overview.totalMessages,
              totalMembers: overview.totalMembers,
              firstMessageTs: overview.firstMessageTs,
              lastMessageTs: overview.lastMessageTs,
              capturedAt: Math.floor(Date.now() / 1000),
            }
          }
        } catch (error) {
          aiLogger.warn('IPC', `Failed to load agent data snapshot: ${requestId}`, { error: String(error) })
        }
        const enrichedContext: ToolContext = { ...context, maxToolResultTokens, dataSnapshot }

        const agent = new Agent(
          enrichedContext,
          piModel,
          activeAIConfig.apiKey,
          {
            abortSignal: abortController.signal,
            thinkingLevel: thinkingLevel as import('@openchatlab/core').ThinkingLevel | undefined,
          },
          chatType ?? 'group',
          locale ?? 'zh-CN',
          assistantConfig,
          skillCtx
        )

        ;(async () => {
          try {
            const result = await agent.executeStream(userMessage, (chunk: AgentStreamChunk) => {
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
            const serializedError = serializeError(error, activeAIConfig.provider)
            serializedError.friendlyMessage = formatAIError(error, {
              providerName: resolveProviderName(activeAIConfig.provider),
              rawErrorLabel: t('llm.rawErrorLabel'),
            })
            if (!serializedError.url && activeAIConfig.baseUrl) {
              serializedError.url = activeAIConfig.baseUrl
            }
            aiLogger.error('IPC', `Agent execution error: ${requestId}`, serializedError)
            win.webContents.send('agent:streamChunk', {
              requestId,
              chunk: { type: 'error', error: serializedError, isFinished: true },
            })
            win.webContents.send('agent:complete', {
              requestId,
              result: {
                content: '',
                toolsUsed: [],
                toolRounds: 0,
                totalUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                error: serializedError,
              },
            })
          } finally {
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

  // ==================== 上下文 token 估算 ====================

  ipcMain.handle('ai:estimateContextTokens', async (_, conversationId: string) => {
    try {
      const history = getConversationManager().getHistoryForAgent(conversationId)
      const tokens = countMessagesTokens(history.map((m) => ({ role: m.role, content: m.content })))
      return { success: true, tokens, messageCount: history.length }
    } catch (error) {
      return { success: false, tokens: 0, error: String(error) }
    }
  })
}
