/**
 * 服务端 Agent
 *
 * 使用 @openchatlab/node-runtime 的 runAgentCore 编排对话流程，
 * 通过 AgentEventHandler 输出与 Electron 端一致的流式事件。
 */

import {
  DEFAULT_MAX_TOOL_ROUNDS,
  buildPlanGuidance,
  createAnalysisPlanner,
  createLlmRouteDecider,
  createPlanContentBlock,
  decideRequestRoute,
  runAgentCore,
  checkAndCompress,
  buildSystemPrompt,
  createAiTranslate,
  createCompressionLlmAdapter,
  AgentEventHandler,
  formatAIError,
  getChartPlannerCapabilityForMessage,
  initTokenizer,
  type AgentStreamChunk,
  type PiMessage,
  type SimpleHistoryMessage,
  type AIChatManager,
  type CompressionConfig,
  type AgentTool,
  type DataSnapshot,
  type OwnerInfo,
  type MentionedMember,
} from '@openchatlab/node-runtime'

import { getDefaultAssistantConfig, buildPiModel } from './llm-config'
import { getServerAiLogger } from './logger'

export type { AgentStreamChunk }

export interface RunAgentOptions {
  userMessage: string
  aiChatId: string
  historyLeafMessageId?: string | null
  chatType?: 'group' | 'private'
  locale?: string
  assistantSystemPrompt?: string
  skillMenu?: string | null
  skillDef?: { name: string; prompt: string }
  compressionConfig?: CompressionConfig
  tools?: AgentTool[]
  aiDataDir: string
  aiChatManager: AIChatManager
  onEvent: (event: AgentStreamChunk) => void
  abortSignal?: AbortSignal
  ownerInfo?: OwnerInfo
  mentionedMembers?: MentionedMember[]
  dataSnapshot?: DataSnapshot
  thinkingLevel?: string
}

export async function runServerAgent(options: RunAgentOptions): Promise<void> {
  const {
    userMessage,
    aiChatId,
    historyLeafMessageId,
    chatType = 'group',
    locale = 'zh-CN',
    assistantSystemPrompt,
    skillMenu,
    skillDef,
    compressionConfig,
    tools = [],
    aiDataDir,
    aiChatManager,
    onEvent,
    abortSignal,
    ownerInfo,
    mentionedMembers,
    dataSnapshot,
    thinkingLevel,
  } = options

  const aiLogger = getServerAiLogger()

  // 确保 tokenizer rank 表已加载（compression + agent 路径均依赖）
  await initTokenizer()

  const llmConfig = getDefaultAssistantConfig(aiDataDir)
  if (!llmConfig) {
    onEvent({ type: 'error', error: { name: 'ConfigError', message: 'LLM service not configured' } })
    onEvent({ type: 'done', isFinished: true })
    return
  }

  const piModel = buildPiModel(llmConfig)
  const t = createAiTranslate(locale)

  let skillCtx: { skillDef?: { name: string; prompt: string }; skillMenu?: string } | undefined
  if (skillDef) {
    skillCtx = { skillDef }
  } else if (skillMenu) {
    skillCtx = { skillMenu }
  }

  const systemPrompt = buildSystemPrompt({
    t,
    chatType,
    assistantSystemPrompt,
    ownerInfo,
    locale,
    skillCtx,
    mentionedMembers,
    dataSnapshot,
  })

  const handler = new AgentEventHandler({
    onChunk: onEvent,
    context: {},
    systemPrompt,
  })

  if (compressionConfig?.enabled && historyLeafMessageId === undefined) {
    const llmAdapter = createCompressionLlmAdapter({
      piModel,
      apiKey: llmConfig.apiKey,
      onCompressing: () => handler.emitStatus('compressing', []),
    })
    const compressionResult = await checkAndCompress(
      aiChatId,
      compressionConfig,
      systemPrompt,
      llmAdapter,
      aiChatManager,
      aiLogger ?? undefined
    )
    if (compressionResult.compressed) {
      onEvent({
        type: 'compression_done',
        compressionResult: {
          summaryContent: compressionResult.summaryContent ?? '',
          tokensBefore: compressionResult.tokensBefore ?? 0,
          tokensAfter: compressionResult.tokensAfter ?? 0,
          timestamp: Date.now(),
        },
      })
    }
  } else if (compressionConfig?.enabled && historyLeafMessageId !== undefined) {
    aiLogger?.info?.('Compression', 'Skipping compression for edited branch request', {
      aiChatId,
      historyLeafMessageId,
    })
  }

  if (abortSignal?.aborted) {
    handler.emitStatus('aborted', [], { force: true })
    onEvent({ type: 'done', isFinished: true, usage: handler.cloneUsage() })
    return
  }

  let history: SimpleHistoryMessage[] = []
  try {
    history = aiChatManager.getHistoryForAgent(aiChatId, undefined, historyLeafMessageId)
  } catch {
    // empty history on failure
  }

  handler.emitStatus('preparing', [], { pendingUserMessage: userMessage, force: true })

  const steerMessage = t('ai.agent.answerWithoutTools')
  let cachedMessages: PiMessage[] = []

  try {
    const routeInput = {
      userMessage,
      chatType,
      locale,
      dataSnapshot,
      availableTools: tools.map((tool) => tool.name),
      availableCapabilities: [
        getChartPlannerCapabilityForMessage({
          userMessage,
          locale,
          availableTools: tools.map((tool) => tool.name),
        }),
      ].filter((capability) => capability !== null),
      skillSummary: skillDef?.name ?? (skillMenu ? 'auto_skill_menu' : undefined),
    }
    const routeStartedAt = Date.now()
    const routeDecision = await decideRequestRoute(routeInput, {
      llmRouter: createLlmRouteDecider({
        piModel,
        apiKey: llmConfig.apiKey,
        abortSignal,
      }),
    })
    aiLogger?.info('Router', 'Shadow route decision', {
      ...routeDecision,
      elapsedMs: Date.now() - routeStartedAt,
      availableToolCount: tools.length,
      shadowOnly: true,
    })
    onEvent({ type: 'route', routeDecision })

    let effectiveSystemPrompt = systemPrompt
    if (routeDecision.route === 'planned_execution') {
      const planStartedAt = Date.now()
      const planner = createAnalysisPlanner({
        piModel,
        apiKey: llmConfig.apiKey,
        onPlanDelta: (delta) => onEvent({ type: 'plan_delta', planDelta: delta }),
        onThinkingDelta: (delta) => onEvent({ type: 'think', content: delta, thinkTag: 'thinking' }),
        onThinkingEnd: (durationMs) =>
          onEvent({ type: 'think', content: '', thinkTag: 'thinking', thinkDurationMs: durationMs }),
        onValidationDelta: (delta) => onEvent({ type: 'think', content: delta, thinkTag: 'plan_validation' }),
        onValidationEnd: (durationMs) =>
          onEvent({ type: 'think', content: '', thinkTag: 'plan_validation', thinkDurationMs: durationMs }),
      })
      const plan = await planner(routeInput, abortSignal)
      if (plan) {
        const planBlock = createPlanContentBlock(plan)
        onEvent({ type: 'plan', plan: planBlock })
        effectiveSystemPrompt = `${systemPrompt}\n\n${buildPlanGuidance(plan)}`
        aiLogger?.info('Planner', 'Plan generated', {
          title: plan.title,
          steps: plan.steps.length,
          successCriteria: plan.successCriteria.length,
          elapsedMs: Date.now() - planStartedAt,
        })
      } else {
        aiLogger?.warn('Planner', 'Plan generation skipped or failed', {
          elapsedMs: Date.now() - planStartedAt,
          route: routeDecision.route,
        })
        onEvent({ type: 'plan_skipped' })
      }
    }

    const result = await runAgentCore({
      piModel,
      apiKey: llmConfig.apiKey,
      systemPrompt: effectiveSystemPrompt,
      tools,
      history,
      userMessage,
      maxToolRounds: DEFAULT_MAX_TOOL_ROUNDS,
      abortSignal,
      steerMessage,
      thinkingLevel: thinkingLevel as import('@openchatlab/core').ThinkingLevel | undefined,
      onConvertToLlm: (filteredMessages) => {
        cachedMessages = filteredMessages as PiMessage[]
      },
      onEvent: (coreEvent) => handler.handleCoreEvent(coreEvent, cachedMessages),
      onDebugContext: (messages) => {
        try {
          aiChatManager.setPendingDebugContext(aiChatId, JSON.stringify(messages, null, 2))
        } catch {
          // silent
        }
      },
    })

    if (result.error) {
      const friendlyMessage = formatAIError(result.error)
      onEvent({ type: 'error', error: { name: 'AgentError', message: friendlyMessage } })
    }

    handler.emitStatus('completed', cachedMessages, { force: true })
    onEvent({ type: 'done', isFinished: true, usage: result.usage })
  } catch (error) {
    const friendlyMessage = formatAIError(error)
    aiLogger?.error('ServerAgent', 'Agent execution error', { error: String(error) })
    handler.emitStatus('error', cachedMessages, { force: true })
    onEvent({ type: 'error', error: { name: 'AgentError', message: friendlyMessage } })
    onEvent({ type: 'done', isFinished: true, usage: handler.cloneUsage() })
  }
}
