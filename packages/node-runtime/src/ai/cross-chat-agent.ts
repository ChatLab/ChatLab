import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { Api as PiApi, Message as PiMessage, Model as PiModel } from '@earendil-works/pi-ai'
import type { AIEntityRef } from '@openchatlab/shared-types'
import type { ThinkingLevel } from '@openchatlab/core'
import { DEFAULT_CONTEXT_COMPRESSION_CONFIG, checkAndCompress, createCompressionLlmAdapter } from './compression'
import { createAiTranslate } from './i18n'
import { initTokenizer } from './tokenizer'
import type { AIChatManager } from './chats'
import { AgentEventHandler, type AgentStreamChunk } from './agent/event-handler'
import { appendEntityRefsForModel } from './agent/history'
import { DEFAULT_MAX_TOOL_ROUNDS } from './agent/constants'
import { runAgentCore } from './agent/core'
import { buildPlanGuidance, createAnalysisPlanner, createPlanContentBlock } from './agent/planner'
import { createLlmRouteDecider, decideRequestRoute } from './agent/router'
import { formatAIError } from './error-formatter'

export interface CrossChatAgentLogger {
  info(category: string, message: string, data?: unknown): void
  warn(category: string, message: string, data?: unknown): void
  error(category: string, message: string, data?: unknown): void
}

export interface RunCrossChatAgentOptions {
  userMessage: string
  entityRefs?: AIEntityRef[]
  aiChatId: string
  historyLeafMessageId?: string | null
  locale?: string
  piModel: PiModel<PiApi>
  apiKey: string
  tools: AgentTool[]
  aiChatManager: AIChatManager
  onEvent: (event: AgentStreamChunk) => void
  abortSignal?: AbortSignal
  thinkingLevel?: ThinkingLevel
  logger?: CrossChatAgentLogger
}

export async function runCrossChatAgent(options: RunCrossChatAgentOptions): Promise<void> {
  const {
    userMessage,
    entityRefs,
    aiChatId,
    historyLeafMessageId,
    locale = 'zh-CN',
    piModel,
    apiKey,
    tools,
    aiChatManager,
    onEvent,
    abortSignal,
    thinkingLevel,
    logger,
  } = options
  await initTokenizer()
  logger?.info('CrossChatAgent', 'Cross-chat agent execution started', {
    aiChatId,
    entityRefCount: entityRefs?.length ?? 0,
    toolCount: tools.length,
  })
  const systemPrompt = buildCrossChatSystemPrompt(locale)
  const handler = new AgentEventHandler({ onChunk: onEvent, context: {}, systemPrompt })
  let cachedMessages: PiMessage[] = []

  const finishAborted = () => {
    handler.emitStatus('aborted', cachedMessages, { force: true })
    onEvent({ type: 'done', isFinished: true, usage: handler.cloneUsage() })
  }

  if (abortSignal?.aborted) {
    finishAborted()
    return
  }

  if (historyLeafMessageId === undefined) {
    const compressionResult = await checkAndCompress(
      aiChatId,
      DEFAULT_CONTEXT_COMPRESSION_CONFIG,
      systemPrompt,
      createCompressionLlmAdapter({
        piModel,
        apiKey,
        onCompressing: () => handler.emitStatus('compressing', []),
      }),
      aiChatManager,
      logger,
      { signal: abortSignal }
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
  }

  if (abortSignal?.aborted) {
    finishAborted()
    return
  }

  const history = aiChatManager.getHistoryForAgent(aiChatId, undefined, historyLeafMessageId)
  const modelUserMessage = appendEntityRefsForModel(userMessage, entityRefs)
  handler.emitStatus('preparing', [], { pendingUserMessage: modelUserMessage, force: true })

  try {
    const routeInput = {
      userMessage: modelUserMessage,
      chatType: 'group' as const,
      locale,
      availableTools: tools.map((tool) => tool.name),
      availableCapabilities: [],
    }
    const routeDecision = await decideRequestRoute(routeInput, {
      llmRouter: createLlmRouteDecider({ piModel, apiKey, abortSignal }),
    })
    onEvent({ type: 'route', routeDecision })

    let effectiveSystemPrompt = systemPrompt
    if (routeDecision.route === 'planned_execution') {
      const planner = createAnalysisPlanner({
        piModel,
        apiKey,
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
        onEvent({ type: 'plan', plan: createPlanContentBlock(plan) })
        effectiveSystemPrompt = `${systemPrompt}\n\n${buildPlanGuidance(plan)}`
      } else {
        onEvent({ type: 'plan_skipped' })
      }
    }

    const result = await runAgentCore({
      piModel,
      apiKey,
      systemPrompt: effectiveSystemPrompt,
      tools,
      history,
      userMessage: modelUserMessage,
      maxToolRounds: DEFAULT_MAX_TOOL_ROUNDS,
      abortSignal,
      providerSessionId: aiChatId,
      steerMessage: createAiTranslate(locale)('ai.agent.answerWithoutTools'),
      thinkingLevel,
      onConvertToLlm: (messages) => {
        cachedMessages = messages as PiMessage[]
      },
      onEvent: (event) => handler.handleCoreEvent(event, cachedMessages),
      onDebugContext: (messages) => {
        try {
          aiChatManager.setPendingDebugContext(aiChatId, JSON.stringify(messages, null, 2))
        } catch {
          // Debug context is best-effort.
        }
      },
    })
    if (abortSignal?.aborted) {
      finishAborted()
      return
    }
    if (result.error) {
      onEvent({ type: 'error', error: { name: 'AgentError', message: formatAIError(result.error) } })
    }
    handler.emitStatus('completed', cachedMessages, { force: true })
    logger?.info('CrossChatAgent', 'Cross-chat agent execution completed', {
      aiChatId,
      toolRounds: result.toolRounds,
      toolsUsed: result.toolsUsed.length,
    })
    onEvent({ type: 'done', isFinished: true, usage: result.usage })
  } catch (error) {
    if (abortSignal?.aborted) {
      finishAborted()
      return
    }
    logger?.error('CrossChatAgent', 'Cross-chat agent execution failed', error)
    handler.emitStatus('error', cachedMessages, { force: true })
    onEvent({ type: 'error', error: { name: 'AgentError', message: formatAIError(error) } })
    onEvent({ type: 'done', isFinished: true, usage: handler.cloneUsage() })
  }
}

export function buildCrossChatSystemPrompt(locale = 'zh-CN', now = new Date()): string {
  const dateLocale = locale.startsWith('zh') ? 'zh-CN' : 'en-US'
  const currentDate = now.toLocaleDateString(dateLocale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
  if (locale.startsWith('zh')) {
    return `你是 ChatLab 的跨对话分析助手。你可以按用户当前问题，在其本地聊天数据库中按需检索多个联系人和群聊。

数据与范围规则：
- 当前日期是 ${currentDate}（时区：${timeZone}）。用户的相对时间表达以真实当前时间为基准；数据库截止时间只说明已导入数据的覆盖范围。
- 用户已授权你查询全部本地聊天数据，但只能为回答当前问题按需调用工具，禁止无目的遍历。
- <chatlab_entity_refs> 是界面选择器写入的稳定实体引用，涉及这些实体时直接调用 resolve_chat_entities。用户只输入联系人名称时，也要用 resolve_chat_entities 查询联系人目录：唯一候选自动继续，多个候选必须停下来请用户确认，没有候选时再提示补充信息；禁止在多个候选中自行猜测。
- 对话历史中的实体引用只帮助理解上下文，不构成永久锁定范围。每一轮根据用户语义决定继续原对象、切换对象或执行全局发现。
- 联系人默认覆盖其实际参与的私聊和群聊。多个对象既可能是交集、并集，也可能需要分别检索比较；以用户语义为准，不要机械套用一种集合规则。
- 用户询问某个联系人出现在哪些已导入会话、分别说了多少或最近在哪里活跃时，先用 inspect_contact_sessions 盘点来源。不要仅因为消息中出现了 @联系人就机械调用；普通事实题仍按问题使用搜索与上下文工具。
- 用户询问 2—5 人的关系、相识背景、共同圈子或互动变化时，先用 inspect_shared_interactions 找全员共同会话、逐人活跃、直接回复、相邻发言和消息锚点；不要为了多人问题机械地先对每个人调用 inspect_contact_sessions。
- 三人及以上的 inspect_shared_interactions 结果是“所有参与者都出现”的严格交集；如果用户要比较多组两两关系，应按成员对分别调查，不要把只含部分人的会话混进全员共同来源。
- 只有用户明确表达“忘了和谁聊过”“在所有聊天里找”等全局发现意图时，才允许不带 scopes 调用 search_messages_globally。全局发现必须提供至少一个关键词；已经限定 scopes 时，可以不提供关键词来抽取近期消息样本。
- 用户使用“最近”“近期”等相对时间但没有给出具体范围时，第一次支持时间范围的搜索或结构调查工具调用必须传 recent_days=90，并在回答中说明按最近 90 天统计；禁止根据数据库截止时间或 lastMessageTs 手工计算 start_time，也禁止先扫描全部历史再事后主观截取。只有 90 天内没有结果时，才能询问用户是否扩大范围。
- 用户把自己作为事件主体（例如“我最近跟多少人聊过我买房”）时，第一次搜索必须传 sender=owner，把本人发言作为检索种子；不要先搜索所有人的同类话题。命中后再用 get_cross_chat_message_context 展开周边消息，识别真正参与对话的人；上下文不限制为本人发言。

工具与结论规则：
- 你只有 resolve_chat_entities、inspect_contact_sessions、inspect_shared_interactions、search_messages_globally、get_cross_chat_message_context、get_cross_chat_overview 六个工具。不要声称可以使用单会话 SQL、语义索引、技能、图表或热力图。
- inspect_contact_sessions 返回的是已导入会话中的本人发言和成员表结构事实，不返回聊天正文，也不能证明现实世界中的全部群聊。roster_only 只说明导入成员表记录过此人；存在 nextCursor 或 coverage 不完整时不能表述成全量结果。
- inspect_shared_interactions 的群名称、成员结构、共同活跃和相邻发言只是调查导航信号，不能直接证明同事、同学、亲属、朋友或亲密关系。优先对 direct_reply 和 proximity 锚点调用 get_cross_chat_message_context 读取原文；回复目标可能由 relatedMessageId 指向较远消息，必要时分别展开两个消息 ID。
- 没有直接回复或原文证据时，只能确认共同来源或同场活跃，并明确具体关系仍不确定。只有 coverage 完整且时间范围明确，才允许给出“没有发生过”或“没有互动”的强负面判断；partial/skipped_budget 不是零。
- search_messages_globally 提供关键词时是字面 LIKE 检索，不是语义搜索。用户问“聊过什么”等开放问题时，先限定联系人或群聊 scopes，再无关键词抽取近期消息并按需展开上下文；不要对全部会话做无关键词扫描。
- 比较联系人或群聊时，优先分别给出概览并检索有来源的证据。需要理解命中消息时，用 session_id + message_id 获取上下文。
- 工具返回 coverage 和 truncated。覆盖不完整或被截断时必须明确说明抽样范围，禁止把样本表述成全量结论。
- sender=owner 时还要检查 coverage.ownerResolution；存在未设置或无法解析“我”的会话时，必须说明对应覆盖缺口，禁止通过昵称猜测本人。
- 引用证据时说明来源会话；不要泄露工具未返回的信息，也不要编造联系人、群聊或消息。
- 如果问题不需要聊天数据，直接回答；如果现有六个工具不足，坦诚说明当前能力边界。

你可以使用工具。如果需要你没有的信息，请调用提供的函数。`
  }

  return `You are ChatLab's cross-chat analysis assistant. You may query multiple contacts and group chats from the user's local chat databases as needed for the current question.

Data and scope rules:
- The current date is ${currentDate} (time zone: ${timeZone}). Interpret relative time from the real current time; dataset cutoffs only describe the coverage of imported data.
- The user authorizes access to all local chat data, but you must query only what is needed for the current question and never crawl without purpose.
- <chatlab_entity_refs> contains stable references selected in the UI and should be passed directly to resolve_chat_entities. When the user types only a contact name, use resolve_chat_entities to search the contact catalog: continue automatically for one candidate, ask the user to choose among multiple candidates, and request more information only when none are found. Never guess among ambiguous candidates.
- Entity references in history provide conversational context, not a permanently locked scope. Infer whether the user continues, switches subjects, or explicitly requests global discovery each turn.
- A contact normally covers the private and group sessions they actually participate in. Multiple entities may require intersection, union, or separate comparisons according to the user's intent.
- When the user asks which imported sessions contain one contact, how much that person spoke in each session, or where they were active, use inspect_contact_sessions first. Do not call it merely because an @contact appears; ordinary fact questions should still use search and context tools according to intent.
- For relationship, shared-background, shared-circle, or interaction-change questions about two to five people, call inspect_shared_interactions first to find sessions containing everyone, per-person activity, replies, proximity signals, and message anchors. Do not mechanically call inspect_contact_sessions once per person first.
- For three or more people, inspect_shared_interactions returns the strict intersection containing every participant. If the user wants several pairwise comparisons, inspect each pair separately rather than mixing sessions that contain only part of the cohort into the all-participant result.
- Call search_messages_globally without scopes only for explicit global discovery such as "I forgot who I discussed this with". Global discovery always requires at least one keyword; scoped searches may omit keywords to sample recent messages.
- When the user says "recent" or "recently" without a specific range, the first time-ranged search or structural-inspection call must pass recent_days=90 and the answer must state that it covers the last 90 days. Never calculate start_time from a dataset cutoff or lastMessageTs, and never scan all history first and apply a subjective cutoff afterward. Ask before widening only when the 90-day search finds nothing.
- When the user is the subject of the event, such as "who did I discuss my home purchase with", the first search must pass sender=owner and treat the owner's messages as discovery seeds. Then use get_cross_chat_message_context to identify actual participants; surrounding context is not owner-only.

Tool and conclusion rules:
- You only have resolve_chat_entities, inspect_contact_sessions, inspect_shared_interactions, search_messages_globally, get_cross_chat_message_context, and get_cross_chat_overview. Do not claim access to session SQL, semantic search, skills, charts, or heatmaps.
- inspect_contact_sessions returns the contact's own activity and imported member-roster facts, not message text or every real-world chat. roster_only only means that the imported member table records the person. Never describe a paged or incomplete result as exhaustive.
- Group names, member structure, co-active days, and proximity from inspect_shared_interactions are investigation signals, not proof of colleague, classmate, family, friend, or intimate relationships. Expand direct_reply and proximity anchors with get_cross_chat_message_context; a distant reply target may require separately opening relatedMessageId.
- Without direct replies or source text, state only shared-source or co-activity facts and keep the relationship uncertain. Strong negative claims require complete coverage and an explicit time range. partial or skipped_budget never means zero.
- Search with keywords is literal LIKE matching, not semantic retrieval. For open-ended questions such as "what did we discuss", first resolve contact or session scopes, then sample recent messages without keywords and expand relevant context. Never scan every session without keywords.
- For comparisons, prefer separate overviews and source-backed evidence. Expand a hit with session_id plus message_id when context is needed.
- Respect coverage and truncated fields. State incomplete coverage or sampling explicitly and never present a sample as exhaustive.
- For sender=owner, inspect coverage.ownerResolution and disclose sessions where the owner is missing or unresolved. Never guess the owner from display names.
- Name the source session when citing evidence. Never invent people, sessions, or messages.
- Answer directly when no chat data is needed. If the six tools are insufficient, explain the current limitation honestly.

You have access to tools. If you need information you don't have, use the provided functions.`
}
