/**
 * AI Agent 执行器
 * 编排 runAgentCore 的对话流程（工具调用、流式输出、中止控制）
 */

import { getDefaultAssistantConfig, buildPiModel } from '../llm'
import { getAllTools, createActivateSkillTool } from '../tools'
import type { ToolContext } from '../tools/types'
import { getHistoryForAgent, setPendingDebugContext } from '../chats'
import { aiLogger, isDebugMode } from '../logger'
import { t as i18nT } from '../../i18n'
import {
  DEFAULT_MAX_TOOL_ROUNDS,
  buildPlanGuidance,
  createAnalysisPlanner,
  createLlmRouteDecider,
  createPlanContentBlock,
  decideRequestRoute,
  runAgentCore,
  streamSimple,
  type PiMessage,
  type PiAssistantMessage,
  type PiModel,
  type PiApi,
} from '@openchatlab/node-runtime'

import type { AgentConfig, AgentStreamChunk, AgentResult, SkillContext } from './types'
import type { AssistantConfig } from '../assistant/types'
import { buildSystemPrompt } from './prompt-builder'
import { extractThinkingContent, stripToolCallTags } from '@openchatlab/core'
import { AgentEventHandler } from '@openchatlab/node-runtime'

type SimpleHistoryMessage = { role: 'user' | 'assistant' | 'summary'; content: string }

// Re-export types for external consumers
export type { AgentConfig, AgentStreamChunk, AgentResult, TokenUsage, AgentRuntimeStatus, SkillContext } from './types'

/**
 * Agent 执行器类
 * 处理带 Function Calling 的对话流程
 */
export class Agent {
  private context: ToolContext
  private config: AgentConfig
  private piModel: PiModel<PiApi>
  private apiKey: string
  private abortSignal?: AbortSignal
  private chatType: 'group' | 'private' = 'group'
  private assistantConfig?: AssistantConfig
  private skillCtx?: SkillContext
  private locale: string = 'zh-CN'

  constructor(
    context: ToolContext,
    piModel: PiModel<PiApi>,
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
      maxToolRounds: config.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS,
      thinkingLevel: config.thinkingLevel,
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
      this.context.mentionedMembers,
      this.context.dataSnapshot
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

    let lastRequestPayload: unknown = null
    const errorCapturingStreamFn: typeof streamSimple = (model, context, options) => {
      return streamSimple(model, context, {
        ...options,
        onPayload: (payload, model) => {
          lastRequestPayload = payload
          return options?.onPayload?.(payload, model)
        },
      })
    }

    const allowedTools = this.assistantConfig?.allowedBuiltinTools
    const toolContext = { ...this.context, locale: this.locale }
    const piTools = getAllTools(toolContext, allowedTools)

    if (this.skillCtx?.skillMenu && !this.skillCtx?.skillDef) {
      piTools.push(createActivateSkillTool(this.chatType, allowedTools, this.locale))
    }

    const routeInput = {
      userMessage,
      chatType: this.chatType,
      locale: this.locale,
      dataSnapshot: this.context.dataSnapshot,
      availableTools: piTools.map((tool) => tool.name),
      assistantSummary: this.assistantConfig?.name,
      skillSummary: this.skillCtx?.skillDef?.name ?? (this.skillCtx?.skillMenu ? 'auto_skill_menu' : undefined),
    }

    const routeStartedAt = Date.now()
    const routeDecision = await decideRequestRoute(routeInput, {
      llmRouter: createLlmRouteDecider({
        piModel: this.piModel,
        apiKey: this.apiKey,
        abortSignal: this.abortSignal,
      }),
    })
    aiLogger.info('Router', 'Shadow route decision', {
      ...routeDecision,
      elapsedMs: Date.now() - routeStartedAt,
      availableToolCount: piTools.length,
      shadowOnly: true,
    })

    let effectiveSystemPrompt = systemPrompt
    if (routeDecision.route === 'planned_execution') {
      const planStartedAt = Date.now()
      const planner = createAnalysisPlanner({ piModel: this.piModel, apiKey: this.apiKey })
      const plan = await planner(routeInput, this.abortSignal)
      if (plan) {
        const planBlock = createPlanContentBlock(plan)
        onChunk({ type: 'plan', plan: planBlock })
        effectiveSystemPrompt = `${systemPrompt}\n\n${buildPlanGuidance(plan)}`
        aiLogger.info('Planner', 'Plan generated', {
          title: plan.title,
          steps: plan.steps.length,
          successCriteria: plan.successCriteria.length,
          elapsedMs: Date.now() - planStartedAt,
        })
      } else {
        aiLogger.warn('Planner', 'Plan generation skipped or failed', {
          elapsedMs: Date.now() - planStartedAt,
          route: routeDecision.route,
        })
      }
    }

    const historyMessages = this.loadHistory()

    let cachedMessages: PiMessage[] = []

    handler.emitStatus('preparing', cachedMessages, {
      pendingUserMessage: userMessage,
      force: true,
    })

    try {
      const result = await runAgentCore({
        piModel: this.piModel,
        apiKey: this.apiKey,
        systemPrompt: effectiveSystemPrompt,
        tools: maxToolRounds > 0 ? piTools : [],
        history: historyMessages,
        userMessage,
        maxToolRounds,
        abortSignal: this.abortSignal,
        steerMessage: answerWithoutToolsPrompt,
        thinkingLevel: this.config.thinkingLevel,
        streamFn: errorCapturingStreamFn,
        onConvertToLlm: (filteredMessages) => {
          cachedMessages = filteredMessages as PiMessage[]
          if (isDebugMode()) {
            const newMessages = filteredMessages.slice(debugLastLoggedCount) as PiMessage[]
            if (newMessages.length > 0) {
              const parts: string[] = []
              for (const m of newMessages) {
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
                `[DEBUG] LLM round ${debugLlmRound} - ${newMessages.length} new, total ${filteredMessages.length}\n${parts.join('\n')}`
              )
            }
            debugLastLoggedCount = filteredMessages.length
            debugLlmRound++
          }
        },
        onDebugContext: (messages) => {
          if (isDebugMode() && this.context.aiChatId) {
            try {
              setPendingDebugContext(this.context.aiChatId, JSON.stringify(messages, null, 2))
            } catch {
              // silent
            }
          }
        },
        onEvent: (event) => handler.handleCoreEvent(event, cachedMessages),
      })

      if (this.isAborted()) {
        handler.emitStatus('aborted', cachedMessages, { force: true })
        onChunk({ type: 'done', isFinished: true, usage: handler.cloneUsage() })
        return {
          content: '',
          toolsUsed: [...handler.toolsUsed],
          toolRounds: handler.toolRounds,
          totalUsage: handler.cloneUsage(),
        }
      }

      if (result.error) {
        const agentError = new Error(result.error) as Error & {
          agentContext?: {
            provider?: string
            model?: string
            api?: string
            url?: string
            requestBody?: string
          }
        }
        const lastMsg = [...result.finalMessages].reverse().find((m) => m.role === 'assistant') as
          | (PiAssistantMessage & { provider?: string; model?: string; api?: string })
          | undefined
        const ctx: NonNullable<typeof agentError.agentContext> = {}
        if (lastMsg) {
          ctx.provider = lastMsg.provider
          ctx.model = lastMsg.model
          ctx.api = lastMsg.api
        }
        const baseUrl = (this.piModel as unknown as Record<string, unknown>).baseUrl as string | undefined
        if (baseUrl) {
          const apiType = lastMsg?.api || (this.piModel as unknown as Record<string, unknown>).api
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

      const finalAssistant = [...result.finalMessages]
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

      handler.emitStatus('completed', cachedMessages, { force: true })
      onChunk({ type: 'done', isFinished: true, usage: result.usage })

      return {
        content: finalContent,
        toolsUsed: [...result.toolsUsed],
        toolRounds: result.toolRounds,
        totalUsage: result.usage,
      }
    } catch (error) {
      const phase = this.isAborted() ? 'aborted' : 'error'
      handler.emitStatus(phase, cachedMessages, { force: true })
      throw error
    }
  }

  private loadHistory(): SimpleHistoryMessage[] {
    const { aiChatId } = this.context
    if (!aiChatId) {
      return []
    }
    try {
      return getHistoryForAgent(aiChatId, undefined, this.context.historyLeafMessageId)
    } catch (error) {
      aiLogger.warn('Agent', 'Failed to load history from DB, using empty history', { aiChatId, error })
      return []
    }
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
  const activeConfig = getDefaultAssistantConfig()
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
  const activeConfig = getDefaultAssistantConfig()
  if (!activeConfig) throw new Error('LLM service not configured')
  const piModel = buildPiModel(activeConfig)
  const agent = new Agent(context, piModel, activeConfig.apiKey, config, chatType, locale, assistantConfig, skillCtx)
  return agent.executeStream(userMessage, onChunk)
}
