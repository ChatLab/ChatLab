/**
 * AI Agent 执行器
 * 编排 PiAgentCore 的对话流程（工具调用、流式输出、中止控制）
 */

import { getActiveConfig, buildPiModel } from '../llm'
import { getAllTools, createActivateSkillTool } from '../tools'
import type { ToolContext } from '../tools/types'
import { getHistoryForAgent } from '../conversations'
import { aiLogger, isDebugMode } from '../logger'
import { t as i18nT } from '../../i18n'
import { Agent as PiAgentCore } from '@mariozechner/pi-agent-core'
import {
  type AssistantMessage as PiAssistantMessage,
  type Message as PiMessage,
  type Usage as PiUsage,
  streamSimple,
} from '@mariozechner/pi-ai'

import type { AgentConfig, AgentStreamChunk, AgentResult, SkillContext } from './types'
import type { AssistantConfig } from '../assistant/types'
import { buildSystemPrompt } from './prompt-builder'
import { extractThinkingContent, stripToolCallTags } from './content-parser'
import { AgentEventHandler } from './event-handler'

type SimpleHistoryMessage = { role: 'user' | 'assistant'; content: string }

// Re-export types for external consumers
export type { AgentConfig, AgentStreamChunk, AgentResult, TokenUsage, AgentRuntimeStatus, SkillContext } from './types'

/**
 * Agent 执行器类
 * 处理带 Function Calling 的对话流程
 */
export class Agent {
  private context: ToolContext
  private config: AgentConfig
  private piModel: import('@mariozechner/pi-ai').Model<any>
  private apiKey: string
  private abortSignal?: AbortSignal
  private chatType: 'group' | 'private' = 'group'
  private assistantConfig?: AssistantConfig
  private skillCtx?: SkillContext
  private locale: string = 'zh-CN'

  constructor(
    context: ToolContext,
    piModel: import('@mariozechner/pi-ai').Model<any>,
    apiKey: string,
    config: AgentConfig = {},
    chatType: 'group' | 'private' = 'group',
    locale: string = 'zh-CN',
    assistantConfig?: AssistantConfig,
    skillCtx?: SkillContext
  ) {
    this.context = context
    this.piModel = piModel
    this.apiKey = apiKey
    this.abortSignal = config.abortSignal
    this.chatType = chatType
    this.assistantConfig = assistantConfig
    this.skillCtx = skillCtx
    this.locale = locale
    this.config = {
      maxToolRounds: config.maxToolRounds ?? 5,
      contextHistoryLimit: config.contextHistoryLimit ?? 48,
    }
  }

  private isAborted(): boolean {
    return this.abortSignal?.aborted ?? false
  }

  async execute(userMessage: string): Promise<AgentResult> {
    return this.executeStream(userMessage, () => {})
  }

  async executeStream(userMessage: string, onChunk: (chunk: AgentStreamChunk) => void): Promise<AgentResult> {
    aiLogger.info('Agent', 'User question', userMessage)

    const maxToolRounds = Math.max(0, this.config.maxToolRounds ?? 0)

    const systemPrompt = buildSystemPrompt(
      this.chatType,
      this.assistantConfig?.systemPrompt,
      this.context.ownerInfo,
      this.locale,
      this.skillCtx,
      this.context.mentionedMembers
    )
    const answerWithoutToolsPrompt = i18nT('ai.agent.answerWithoutTools', { lng: this.locale })

    const handler = new AgentEventHandler({
      onChunk,
      context: this.context,
      systemPrompt,
    })

    if (this.isAborted()) {
      handler.emitStatus('aborted', [], { force: true })
      onChunk({ type: 'done', isFinished: true, usage: handler.cloneUsage() })
      return { content: '', toolsUsed: [], toolRounds: 0, totalUsage: handler.cloneUsage() }
    }

    let debugLastLoggedCount = 0
    let debugLlmRound = 1

    // 捕获最后一次 LLM 调用的请求体（用于错误诊断）
    let lastRequestPayload: unknown = null
    const errorCapturingStreamFn: typeof streamSimple = (model, context, options) => {
      return streamSimple(model, context, {
        ...options,
        onPayload: (payload) => {
          lastRequestPayload = payload
          options?.onPayload?.(payload)
        },
      })
    }

    // 初始化 PiAgentCore
    const coreAgent = new PiAgentCore({
      initialState: {
        model: this.piModel,
        thinkingLevel: this.piModel.reasoning ? 'medium' : 'off',
      },
      getApiKey: () => this.apiKey,
      streamFn: errorCapturingStreamFn,
      convertToLlm: (messages) => {
        const filtered = messages.filter(
          (msg): msg is PiMessage => msg.role === 'user' || msg.role === 'assistant' || msg.role === 'toolResult'
        )
        if (isDebugMode()) {
          const newMessages = filtered.slice(debugLastLoggedCount)
          if (newMessages.length > 0) {
            const parts: string[] = []
            for (const m of newMessages) {
              // pi-ai 的 Message 联合类型较严格，这里仅用于调试日志读取动态字段。
              const msg = m as unknown as Record<string, unknown>
              parts.push(`--- ${msg.role} ---`)
              const content = msg.content as
                | Array<{ type: string; text?: string; name?: string; arguments?: unknown }>
                | undefined
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'text' && block.text) {
                    parts.push(block.text)
                  } else if (block.type === 'toolCall') {
                    parts.push(`[Tool Call] ${block.name}(${JSON.stringify(block.arguments)})`)
                  }
                }
              }
            }
            aiLogger.debug(
              'Agent',
              `[DEBUG] LLM round ${debugLlmRound} - ${newMessages.length} new, total ${filtered.length}\n${parts.join('\n')}`
            )
          }
          debugLastLoggedCount = filtered.length
          debugLlmRound++
        }
        return filtered
      },
    })

    // 配置 prompt、工具、历史
    coreAgent.setSystemPrompt(systemPrompt)
    const allowedTools = this.assistantConfig?.allowedBuiltinTools
    const toolContext = { ...this.context, locale: this.locale }
    const piTools = getAllTools(toolContext, allowedTools)

    // AI 自选模式：注册 activate_skill 元工具（手动选择时不注册，避免冲突）
    if (this.skillCtx?.skillMenu && !this.skillCtx?.skillDef) {
      piTools.push(createActivateSkillTool(this.chatType, allowedTools, this.locale))
    }

    coreAgent.setTools(maxToolRounds > 0 ? piTools : [])

    const limit = this.config.contextHistoryLimit ?? 48
    const historyMessages = this.loadHistory(limit)
    coreAgent.replaceMessages(this.toPiHistoryMessages(historyMessages))

    handler.emitStatus('preparing', coreAgent.state.messages, {
      pendingUserMessage: userMessage,
      force: true,
    })

    // 订阅事件
    const subscriber = handler.createSubscriber(coreAgent, maxToolRounds, answerWithoutToolsPrompt)
    const unsubscribe = coreAgent.subscribe(subscriber)

    // Abort 转发
    const forwardAbort = () => coreAgent.abort()
    if (this.abortSignal) {
      this.abortSignal.addEventListener('abort', forwardAbort, { once: true })
    }

    try {
      if (isDebugMode()) {
        aiLogger.debug('Agent', `[DEBUG] System prompt`, systemPrompt)
      }

      await coreAgent.prompt(userMessage)

      if (this.isAborted()) {
        handler.emitStatus('aborted', coreAgent.state.messages, { force: true })
        onChunk({ type: 'done', isFinished: true, usage: handler.cloneUsage() })
        return {
          content: '',
          toolsUsed: [...handler.toolsUsed],
          toolRounds: handler.toolRounds,
          totalUsage: handler.cloneUsage(),
        }
      }

      if (coreAgent.state.error) {
        const agentError = new Error(coreAgent.state.error) as Error & {
          agentContext?: {
            provider?: string
            model?: string
            api?: string
            url?: string
            requestBody?: string
          }
        }
        const lastMsg = [...coreAgent.state.messages].reverse().find((m) => m.role === 'assistant') as
          | (PiAssistantMessage & { provider?: string; model?: string; api?: string })
          | undefined
        const ctx: NonNullable<typeof agentError.agentContext> = {}
        if (lastMsg) {
          ctx.provider = lastMsg.provider
          ctx.model = lastMsg.model
          ctx.api = lastMsg.api
        }
        // 从 model.baseUrl 和 api 类型构造完整请求 URL
        const baseUrl = (this.piModel as Record<string, unknown>).baseUrl as string | undefined
        if (baseUrl) {
          const apiType = lastMsg?.api || (this.piModel as Record<string, unknown>).api
          const pathMap: Record<string, string> = {
            'openai-completions': '/chat/completions',
            'openai-responses': '/responses',
            'anthropic-messages': '/messages',
          }
          const apiPath = typeof apiType === 'string' ? pathMap[apiType] : undefined
          ctx.url = apiPath ? baseUrl.replace(/\/+$/, '') + apiPath : baseUrl
        }
        if (lastRequestPayload) {
          try {
            ctx.requestBody = JSON.stringify(lastRequestPayload, null, 2)
          } catch {
            // ignore
          }
        }
        agentError.agentContext = ctx
        throw agentError
      }

      // 提取最终回复
      const finalAssistant = [...coreAgent.state.messages]
        .reverse()
        .find((msg): msg is PiAssistantMessage => msg.role === 'assistant')

      const finalRawContent =
        finalAssistant?.content
          .filter((item) => item.type === 'text')
          .map((item) => item.text)
          .join('') || ''

      const finalContent = stripToolCallTags(extractThinkingContent(finalRawContent).cleanContent)

      if (isDebugMode() && finalContent) {
        aiLogger.debug('Agent', `[DEBUG] Final response\n${finalContent}`)
      }

      handler.emitStatus('completed', coreAgent.state.messages, { force: true })
      onChunk({ type: 'done', isFinished: true, usage: handler.cloneUsage() })

      return {
        content: finalContent,
        toolsUsed: [...handler.toolsUsed],
        toolRounds: handler.toolRounds,
        totalUsage: handler.cloneUsage(),
      }
    } catch (error) {
      const phase = this.isAborted() ? 'aborted' : 'error'
      handler.emitStatus(phase, coreAgent.state.messages, { force: true })
      throw error
    } finally {
      unsubscribe()
      if (this.abortSignal) {
        this.abortSignal.removeEventListener('abort', forwardAbort)
      }
    }
  }

  /**
   * 从 SQLite 加载对话历史
   * 当 context.conversationId 存在时从 DB 读取，否则返回空数组
   */
  private loadHistory(limit: number): SimpleHistoryMessage[] {
    const { conversationId } = this.context
    if (!conversationId) {
      return []
    }
    try {
      return getHistoryForAgent(conversationId, limit > 0 ? limit : undefined)
    } catch (error) {
      aiLogger.warn('Agent', 'Failed to load history from DB, using empty history', { conversationId, error })
      return []
    }
  }

  private createEmptyPiUsage(): PiUsage {
    return {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    }
  }

  private toPiHistoryMessages(messages: SimpleHistoryMessage[]): PiMessage[] {
    return messages.map((msg): PiMessage => {
      if (msg.role === 'user') {
        return {
          role: 'user',
          content: [{ type: 'text', text: msg.content || '' }],
          timestamp: Date.now(),
        }
      }

      return {
        role: 'assistant',
        content: [{ type: 'text', text: msg.content || '' }],
        api: 'openai-completions',
        provider: 'chatlab',
        model: 'unknown',
        usage: this.createEmptyPiUsage(),
        stopReason: 'stop',
        timestamp: Date.now(),
      }
    })
  }
}

/**
 * 创建 Agent 并执行对话（便捷函数）
 */
export async function runAgent(
  userMessage: string,
  context: ToolContext,
  config?: AgentConfig,
  chatType?: 'group' | 'private',
  locale?: string,
  assistantConfig?: AssistantConfig,
  skillCtx?: SkillContext
): Promise<AgentResult> {
  const activeConfig = getActiveConfig()
  if (!activeConfig) throw new Error('LLM service not configured')
  const piModel = buildPiModel(activeConfig)
  const agent = new Agent(context, piModel, activeConfig.apiKey, config, chatType, locale, assistantConfig, skillCtx)
  return agent.execute(userMessage)
}

/**
 * 创建 Agent 并流式执行对话（便捷函数）
 */
export async function runAgentStream(
  userMessage: string,
  context: ToolContext,
  onChunk: (chunk: AgentStreamChunk) => void,
  config?: AgentConfig,
  chatType?: 'group' | 'private',
  locale?: string,
  assistantConfig?: AssistantConfig,
  skillCtx?: SkillContext
): Promise<AgentResult> {
  const activeConfig = getActiveConfig()
  if (!activeConfig) throw new Error('LLM service not configured')
  const piModel = buildPiModel(activeConfig)
  const agent = new Agent(context, piModel, activeConfig.apiKey, config, chatType, locale, assistantConfig, skillCtx)
  return agent.executeStream(userMessage, onChunk)
}
