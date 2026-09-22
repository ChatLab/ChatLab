/**
 * Agent Core — 共享的 PiAgentCore 编排逻辑
 *
 * 封装：构建 → 历史转换 → 事件订阅 → abort 转发 → prompt 执行 → usage 收集。
 * Server 和 Electron 通过 AgentCoreOptions DI 注入平台差异。
 */

import { Agent as PiAgentCore } from '@earendil-works/pi-agent-core'
import type { AgentEvent as PiAgentEvent, AgentMessage as PiAgentMessage } from '@earendil-works/pi-agent-core'
import {
  type Context as PiContext,
  type AssistantMessage,
  type Message as PiMessage,
  type Usage as PiUsage,
  clampThinkingLevel,
} from '@earendil-works/pi-ai'
import { StreamingThinkTagParser, needsStreamingThinkParsing } from '@openchatlab/core'
import type { ToolProgress } from '@openchatlab/shared-types'

import type { AgentCoreOptions, AgentCoreResult, AgentTokenUsage } from './types'
import { countTokens, initTokenizer } from '../tokenizer'
import { createAiTranslate } from '../i18n'
import { streamSimple as defaultStreamSimple } from '../pi-runtime'
import { DEFAULT_MAX_TOOL_ROUNDS } from './constants'
import { toPiHistoryMessages, type ReplayOptions } from './history'

function isPiMessage(message: PiAgentMessage): message is PiMessage {
  return message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult'
}

function fitToolResults(context: PiContext, contextWindow: number, maxTokens: number) {
  // Match Pi's output safety margin. cl100k is an estimate for other providers;
  // also cover Pi's character estimate so trimming does not starve the answer.
  const safetyTokens = Math.min(4096, Math.floor(contextWindow / 2))
  const budget = contextWindow - safetyTokens - Math.min(maxTokens, Math.floor(contextWindow / 4))
  const estimate = (text: string) => {
    // Bound tokenizer work for long unbroken tool output (e.g. CJK or encoded data).
    let tokens = 0
    for (let i = 0; i < text.length; i += 256) tokens += countTokens(text.slice(i, i + 256))
    return Math.max(tokens, Math.ceil(text.length / 4))
  }
  const messageTokens = (message: PiMessage) =>
    8 +
    estimate(
      JSON.stringify({
        role: message.role,
        content: message.content,
        ...(message.role === 'toolResult' ? { toolCallId: message.toolCallId, toolName: message.toolName } : {}),
      })
    )
  let tokens =
    8 +
    estimate(context.systemPrompt ?? '') +
    estimate(
      JSON.stringify(
        context.tools?.map(({ name, description, parameters }) => ({ name, description, parameters })) ?? []
      )
    ) +
    context.messages.reduce((sum, message) => sum + messageTokens(message), 0)
  if (tokens <= budget) return { context, maxTokens: Math.min(maxTokens, contextWindow - tokens - 16) }

  const messages = context.messages.slice()
  const marker = '\n[Tool result truncated to fit the context window. Use a narrower query if needed.]'
  // Retain recent evidence first; edit only the request view, never the transcript.
  for (let i = 0; i < messages.length && tokens > budget; i++) {
    const message = messages[i]
    if (message.role !== 'toolResult') continue
    const content = message.content.slice()
    for (let j = 0; j < content.length && tokens > budget; j++) {
      const block = content[j]
      if (block.type !== 'text') continue
      const before = messageTokens({ ...message, content })
      content[j] = { ...block, text: marker }
      const after = messageTokens({ ...message, content })
      if (after >= before) {
        content[j] = block
        continue
      }
      if (tokens - before + after <= budget) {
        let low = 0
        let high = block.text.length
        while (low < high) {
          const mid = Math.ceil((low + high) / 2)
          content[j] = { ...block, text: block.text.slice(0, mid) + marker }
          if (tokens - before + messageTokens({ ...message, content }) <= budget) low = mid
          else high = mid - 1
        }
        content[j] = { ...block, text: block.text.slice(0, low) + marker }
      }
      tokens += messageTokens({ ...message, content }) - before
    }
    messages[i] = { ...message, content }
  }
  // The reserve is a target, not a new hard limit on existing user/history text.
  // OpenAI Responses enforces a minimum of 16 output tokens.
  if (tokens + 16 > contextWindow)
    throw new Error(
      'Agent context exceeds the model window after trimming tool results. Start a new conversation or shorten the request.'
    )

  // Provider usage described the untrimmed prefix. Invalidate it only in this
  // request so Pi estimates the edited context instead of reusing stale totals.
  return {
    context: {
      ...context,
      messages: messages.map((message) =>
        message.role === 'assistant'
          ? {
              ...message,
              usage: { ...message.usage, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
            }
          : message
      ),
    },
    maxTokens: Math.max(1, Math.min(maxTokens, contextWindow - tokens - 16)),
  }
}

export async function runAgentCore(options: AgentCoreOptions): Promise<AgentCoreResult> {
  const {
    piModel,
    apiKey,
    systemPrompt,
    tools,
    history,
    userMessage,
    maxToolRounds = DEFAULT_MAX_TOOL_ROUNDS,
    abortSignal,
    steerMessage = 'Please provide your final answer based on the information gathered.',
    onEvent,
    onConvertToLlm,
    onDebugContext,
  } = options

  // 确保 cl100k rank 表已加载，压缩/预处理路径使用精确 token 计数
  await initTokenizer()

  const resolvedStreamFn = (options.streamFn ?? defaultStreamSimple) as typeof defaultStreamSimple

  const totalUsage: AgentTokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
  const toolsUsed: string[] = []
  let toolRounds = 0
  let lastAssistant: AssistantMessage | undefined

  const addPiUsage = (usage?: PiUsage) => {
    if (!usage) return
    totalUsage.promptTokens += usage.input || 0
    totalUsage.completionTokens += usage.output || 0
    totalUsage.totalTokens += usage.totalTokens || usage.input + usage.output || 0
    totalUsage.cacheReadTokens += usage.cacheRead || 0
    totalUsage.cacheWriteTokens += usage.cacheWrite || 0
  }

  if (abortSignal?.aborted) {
    return { usage: totalUsage, stopReason: 'aborted', finalMessages: [], toolsUsed: [], toolRounds: 0 }
  }

  // Resolve thinkingLevel for pi-agent-core:
  // - 'default'/undefined → strip reasoning from piModel so pi-ai sends a plain request
  //   with NO reasoning params at all (model uses its native default behavior).
  // - 'off' → pi-ai sends disable signals (thinking:{type:'disabled'} / enable_thinking:false)
  // - 'auto' → for thinkingFormat models or effort-based models with thinkingLevelMap,
  //   use 'high' to enable; others no params.
  //   Note: pi-ai's clampThinkingLevel only covers EXTENDED_THINKING_LEVELS (no 'auto'),
  //   so 'auto' cannot be forwarded verbatim for effort-based models like Kimi/Doubao.
  //   Returning 'high' ensures reasoning is at least enabled.
  // - Other levels → clamp to what pi-agent-core accepts.
  const isDefault = !options.thinkingLevel || options.thinkingLevel === 'default'
  const effectiveModel = isDefault
    ? { ...piModel, reasoning: false, compat: undefined, thinkingLevelMap: undefined }
    : piModel

  const resolvedThinkingLevel = (() => {
    if (isDefault) return 'off'
    const level = options.thinkingLevel!
    if (level === 'auto') {
      if (!piModel.reasoning) return 'off'
      const compat = piModel.compat as Record<string, unknown> | undefined
      if (compat?.thinkingFormat) return 'high'
      // Effort-based reasoning models (e.g., Kimi, Doubao) have a thinkingLevelMap but no
      // thinkingFormat. pi-ai's clampThinkingLevel can't pass 'auto' through, so use 'high'.
      if (piModel.thinkingLevelMap) return 'high'
      return undefined
    }
    return clampThinkingLevel(piModel, level as Exclude<typeof level, 'default' | 'auto'>)
  })()

  const finalThinkingLevel = resolvedThinkingLevel ?? (piModel.reasoning ? undefined : 'off')
  let hasReachedToolRoundLimit = maxToolRounds <= 0
  let hasCompletedFinalAnswerTurn = false

  // DeepSeek-format APIs require reasoning_content on assistant messages that
  // precede tool results; build replay options so toPiHistoryMessages includes
  // persisted thinking blocks in those messages.
  const thinkingFormat = (piModel.compat as Record<string, unknown> | undefined)?.thinkingFormat
  const replayOptions: ReplayOptions | undefined =
    piModel.reasoning && thinkingFormat === 'deepseek'
      ? {
          modelInfo: { api: piModel.api, provider: piModel.provider, id: piModel.id },
          thinkingSignature: 'reasoning_content',
        }
      : undefined

  const coreAgent = new PiAgentCore({
    initialState: {
      systemPrompt,
      model: effectiveModel,
      thinkingLevel: finalThinkingLevel,
      tools: maxToolRounds > 0 ? tools : [],
      messages: toPiHistoryMessages(history, replayOptions),
    },
    getApiKey: () => apiKey,
    streamFn: (model, context, streamOptions) => {
      const fitted = fitToolResults(context, model.contextWindow, model.maxTokens)
      onConvertToLlm?.(fitted.context.messages)
      return resolvedStreamFn(model, fitted.context, { ...streamOptions, maxTokens: fitted.maxTokens })
    },
    convertToLlm: (messages) => {
      const filtered = messages.filter(
        (msg): msg is PiMessage => msg.role === 'user' || msg.role === 'assistant' || msg.role === 'toolResult'
      )
      return filtered
    },
    afterToolCall: async ({ result }) =>
      (result as { isError?: boolean }).isError === true ? { isError: true } : undefined,
    // A cut-off tool call must not trigger an automatic paid retry either.
    shouldStopAfterTurn: async ({ message }) => message.stopReason === 'length' || hasCompletedFinalAnswerTurn,
    prepareNextTurnWithContext: ({ context }) =>
      hasReachedToolRoundLimit
        ? {
            context: {
              ...context,
              tools: [],
            },
          }
        : undefined,
    sessionId: options.providerSessionId,
    toolExecution: 'parallel',
  })

  const thinkingStartTime = new Map<number, number>()

  // For providers that embed <think> tags in content (e.g. MiniMax),
  // use a streaming parser to split thinking from content.
  const useThinkParser = needsStreamingThinkParsing(piModel.provider, piModel.id)
  let thinkParserStartTime: number | undefined
  const thinkParser = useThinkParser
    ? new StreamingThinkTagParser((ev) => {
        switch (ev.type) {
          case 'content':
            onEvent({ type: 'content', content: ev.content })
            break
          case 'thinking_start':
            thinkParserStartTime = Date.now()
            onEvent({ type: 'thinking_start' })
            break
          case 'thinking_delta':
            onEvent({ type: 'thinking_delta', content: ev.content })
            break
          case 'thinking_end': {
            const durationMs = thinkParserStartTime ? Date.now() - thinkParserStartTime : undefined
            thinkParserStartTime = undefined
            onEvent({ type: 'thinking_end', durationMs })
            break
          }
        }
      })
    : null

  const unsubscribe = coreAgent.subscribe((event: PiAgentEvent) => {
    if (event.type === 'message_update') {
      const update = event.assistantMessageEvent
      if (update.type === 'text_delta') {
        if (thinkParser) {
          thinkParser.feed(update.delta)
        } else {
          onEvent({ type: 'content', content: update.delta })
        }
      } else if (update.type === 'thinking_start') {
        thinkingStartTime.set(update.contentIndex, Date.now())
        onEvent({ type: 'thinking_start' })
      } else if (update.type === 'thinking_delta') {
        onEvent({ type: 'thinking_delta', content: update.delta })
      } else if (update.type === 'thinking_end') {
        const startedAt = thinkingStartTime.get(update.contentIndex)
        const durationMs = startedAt ? Date.now() - startedAt : undefined
        thinkingStartTime.delete(update.contentIndex)
        onEvent({ type: 'thinking_end', durationMs })
      }
    } else if (event.type === 'tool_execution_start') {
      toolsUsed.push(event.toolName)
      onEvent({
        type: 'tool_start',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        toolParams: (event.args || {}) as Record<string, unknown>,
      })
    } else if (event.type === 'tool_execution_update') {
      const details = event.partialResult?.details as { progress?: ToolProgress } | null
      if (details?.progress) {
        onEvent({
          type: 'tool_update',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          progress: details.progress,
        })
      }
    } else if (event.type === 'tool_execution_end') {
      onEvent({
        type: 'tool_end',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        toolResult: event.result,
        isError: event.isError,
      })
    } else if (event.type === 'turn_end') {
      const hadToolCalls = event.toolResults.length > 0
      const isFinalAnswerTurn = hasReachedToolRoundLimit
      if (hadToolCalls && !hasReachedToolRoundLimit) {
        toolRounds += 1
        if (maxToolRounds > 0 && toolRounds >= maxToolRounds) {
          hasReachedToolRoundLimit = true
          coreAgent.state.tools = []
          coreAgent.steer({
            role: 'user',
            content: [{ type: 'text', text: steerMessage }],
            timestamp: Date.now(),
          } as PiMessage)
        }
      }
      if (isFinalAnswerTurn) hasCompletedFinalAnswerTurn = true
      onEvent({ type: 'turn_end', round: toolRounds, hadToolCalls })
    } else if (event.type === 'message_end') {
      if (event.message.role === 'assistant') {
        lastAssistant = event.message
        thinkParser?.flush()
        addPiUsage(event.message.usage)
        onEvent({ type: 'usage_update', usage: { ...totalUsage } })
      }
    }
  })

  const forwardAbort = () => coreAgent.abort()
  if (abortSignal) {
    abortSignal.addEventListener('abort', forwardAbort, { once: true })
  }

  try {
    if (onDebugContext) {
      try {
        const debugMessages = [
          { role: 'system', content: systemPrompt },
          ...history.map((m) => ({
            role: m.role === 'summary' ? 'assistant' : m.role,
            content: m.content,
          })),
          { role: 'user', content: userMessage },
        ]
        onDebugContext(debugMessages)
      } catch {
        // silent — debug context is best-effort
      }
    }

    await coreAgent.prompt(userMessage)

    const stopReason = lastAssistant?.stopReason
    const error =
      coreAgent.state.errorMessage ||
      (stopReason === 'length' ? createAiTranslate(options.locale)('ai.agent.outputLimitReached') : undefined)
    const completionInfo = {
      aiChatId: options.providerSessionId,
      provider: piModel.provider,
      model: piModel.id,
      stopReason,
      rawStopReason: lastAssistant?.rawStopReason,
      configuredMaxOutputTokens: piModel.maxTokens,
      outputTokens: lastAssistant?.usage.output,
      reasoningTokens: lastAssistant?.usage.reasoning,
      toolRounds,
    }
    if (error && !abortSignal?.aborted) {
      options.logger?.error('Agent', 'Agent execution ended without a complete response', completionInfo)
    } else {
      options.logger?.info('Agent', 'Agent execution finished', completionInfo)
    }

    return {
      usage: totalUsage,
      error,
      stopReason,
      finalMessages: coreAgent.state.messages.filter(isPiMessage),
      toolsUsed: [...toolsUsed],
      toolRounds,
    }
  } finally {
    unsubscribe()
    if (abortSignal) {
      abortSignal.removeEventListener('abort', forwardAbort)
    }
  }
}
