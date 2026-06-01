/**
 * Agent Core — 共享的 PiAgentCore 编排逻辑
 *
 * 封装：构建 → 历史转换 → 事件订阅 → abort 转发 → prompt 执行 → usage 收集。
 * Server 和 Electron 通过 AgentCoreOptions DI 注入平台差异。
 */

import { Agent as PiAgentCore } from '@earendil-works/pi-agent-core'
import type { AgentEvent as PiAgentEvent, AgentMessage as PiAgentMessage } from '@earendil-works/pi-agent-core'
import {
  type Message as PiMessage,
  type Usage as PiUsage,
  streamSimple as defaultStreamSimple,
  clampThinkingLevel,
} from '@earendil-works/pi-ai'
import { StreamingThinkTagParser, needsStreamingThinkParsing } from '@openchatlab/core'

import type { AgentCoreOptions, AgentCoreResult, AgentTokenUsage, SimpleHistoryMessage } from './types'
import { initTokenizer } from '../tokenizer'

function createEmptyPiUsage(): PiUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

function toPiHistoryMessages(messages: SimpleHistoryMessage[]): PiMessage[] {
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
      usage: createEmptyPiUsage(),
      stopReason: 'stop',
      timestamp: Date.now(),
    }
  })
}

function isPiMessage(message: PiAgentMessage): message is PiMessage {
  return message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult'
}

export async function runAgentCore(options: AgentCoreOptions): Promise<AgentCoreResult> {
  const {
    piModel,
    apiKey,
    systemPrompt,
    tools,
    history,
    userMessage,
    maxToolRounds = 5,
    abortSignal,
    steerMessage = 'Please provide your final answer based on the information gathered.',
    onEvent,
    onConvertToLlm,
    onDebugContext,
  } = options

  // 确保 cl100k rank 表已加载，压缩/预处理路径使用精确 token 计数
  await initTokenizer()

  const resolvedStreamFn = (options.streamFn ?? defaultStreamSimple) as typeof defaultStreamSimple

  const totalUsage: AgentTokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  const toolsUsed: string[] = []
  let toolRounds = 0

  const addPiUsage = (usage?: PiUsage) => {
    if (!usage) return
    totalUsage.promptTokens += usage.input || 0
    totalUsage.completionTokens += usage.output || 0
    totalUsage.totalTokens += usage.totalTokens || usage.input + usage.output || 0
  }

  if (abortSignal?.aborted) {
    return { usage: totalUsage, finalMessages: [], toolsUsed: [], toolRounds: 0 }
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
  console.debug('[agent-core] thinkingLevel resolution:', {
    input: options.thinkingLevel,
    modelId: piModel.id,
    modelReasoning: effectiveModel.reasoning,
    isDefault,
    resolved: resolvedThinkingLevel,
    final: finalThinkingLevel,
  })

  const coreAgent = new PiAgentCore({
    initialState: {
      systemPrompt,
      model: effectiveModel,
      thinkingLevel: finalThinkingLevel,
      tools: maxToolRounds > 0 ? tools : [],
      messages: toPiHistoryMessages(history),
    },
    getApiKey: () => apiKey,
    streamFn: resolvedStreamFn,
    convertToLlm: (messages) => {
      const filtered = messages.filter(
        (msg): msg is PiMessage => msg.role === 'user' || msg.role === 'assistant' || msg.role === 'toolResult'
      )
      onConvertToLlm?.(filtered)
      return filtered
    },
  })

  let hasReachedToolRoundLimit = false
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
        toolName: event.toolName,
        toolParams: (event.args || {}) as Record<string, unknown>,
      })
    } else if (event.type === 'tool_execution_end') {
      onEvent({ type: 'tool_end', toolName: event.toolName, toolResult: event.result })
    } else if (event.type === 'turn_end') {
      const hadToolCalls = event.toolResults.length > 0
      if (hadToolCalls) {
        toolRounds += 1
        if (!hasReachedToolRoundLimit && maxToolRounds > 0 && toolRounds >= maxToolRounds) {
          hasReachedToolRoundLimit = true
          coreAgent.state.tools = []
          coreAgent.steer({
            role: 'user',
            content: [{ type: 'text', text: steerMessage }],
            timestamp: Date.now(),
          } as PiMessage)
        }
      }
      onEvent({ type: 'turn_end', round: toolRounds, hadToolCalls })
    } else if (event.type === 'message_end') {
      if (event.message.role === 'assistant') {
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

    return {
      usage: totalUsage,
      error: coreAgent.state.errorMessage || undefined,
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
