/**
 * 服务端 Agent
 *
 * 使用 @mariozechner/pi-agent-core 编排对话流程，
 * 将流式事件通过回调输出给 SSE 端点。
 */

import { Agent as PiAgentCore } from '@mariozechner/pi-agent-core'
import type { AgentEvent as PiAgentEvent } from '@mariozechner/pi-agent-core'
import { type Message as PiMessage, type Usage as PiUsage, streamSimple } from '@mariozechner/pi-ai'
import type { AIConversationManager } from '@openchatlab/node-runtime'

import { getDefaultAssistantConfig, buildPiModel } from './llm-config'

export interface AgentStreamEvent {
  type: 'content' | 'think' | 'tool_start' | 'tool_result' | 'status' | 'done' | 'error'
  content?: string
  thinkTag?: string
  thinkDurationMs?: number
  toolName?: string
  toolParams?: Record<string, unknown>
  toolResult?: unknown
  error?: { name: string | null; message: string | null }
  isFinished?: boolean
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
  status?: {
    phase: string
    round: number
    toolsUsed: number
    currentTool?: string
  }
}

export interface RunAgentOptions {
  userMessage: string
  conversationId: string
  chatType?: 'group' | 'private'
  locale?: string
  assistantSystemPrompt?: string
  skillMenu?: string | null
  tools?: import('@mariozechner/pi-agent-core').AgentTool[]
  aiDataDir: string
  convManager: AIConversationManager
  onEvent: (event: AgentStreamEvent) => void
  abortSignal?: AbortSignal
}

type SimpleHistoryMessage = { role: 'user' | 'assistant' | 'summary'; content: string }

function buildSystemPrompt(
  _chatType: 'group' | 'private',
  assistantSystemPrompt?: string,
  locale: string = 'zh-CN',
  skillMenu?: string | null
): string {
  const now = new Date()
  const dateLocale = locale.startsWith('zh') ? 'zh-CN' : 'en-US'
  const currentDate = now.toLocaleDateString(dateLocale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })

  const isZh = locale.startsWith('zh')
  const role =
    assistantSystemPrompt ||
    (isZh
      ? '你是 ChatLab AI 助手，一个智能对话助手。请友好、准确地回答用户的问题。'
      : 'You are ChatLab AI assistant, an intelligent conversational assistant. Please answer questions in a friendly and accurate manner.')

  const datePrefix = isZh ? '当前日期是' : 'Current date is'
  const responseNote = isZh
    ? '请直接回答用户的问题，不要使用工具除非确实需要。'
    : "Answer the user's question directly. Only use tools when truly necessary."

  let prompt = `${role}

${datePrefix} ${currentDate}。

${responseNote}`

  if (skillMenu) {
    prompt += `\n\n${skillMenu}`
  }

  return prompt
}

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

export async function runServerAgent(options: RunAgentOptions): Promise<void> {
  const {
    userMessage,
    conversationId,
    chatType = 'group',
    locale = 'zh-CN',
    assistantSystemPrompt,
    skillMenu,
    tools = [],
    aiDataDir,
    convManager,
    onEvent,
    abortSignal,
  } = options

  const llmConfig = getDefaultAssistantConfig(aiDataDir)
  if (!llmConfig) {
    onEvent({ type: 'error', error: { name: 'ConfigError', message: 'LLM service not configured' } })
    onEvent({ type: 'done', isFinished: true })
    return
  }

  const piModel = buildPiModel(llmConfig)
  const maxToolRounds = 5

  const systemPrompt = buildSystemPrompt(chatType, assistantSystemPrompt, locale, skillMenu)
  const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  const toolsUsed: string[] = []
  let toolRounds = 0

  const addPiUsage = (usage?: PiUsage) => {
    if (!usage) return
    totalUsage.promptTokens += usage.input || 0
    totalUsage.completionTokens += usage.output || 0
    totalUsage.totalTokens += usage.totalTokens || usage.input + usage.output || 0
  }

  const isAborted = () => abortSignal?.aborted ?? false

  if (isAborted()) {
    onEvent({ type: 'done', isFinished: true, usage: totalUsage })
    return
  }

  const coreAgent = new PiAgentCore({
    initialState: {
      model: piModel,
      thinkingLevel: piModel.reasoning ? 'medium' : 'off',
    },
    getApiKey: () => llmConfig.apiKey,
    streamFn: streamSimple,
    convertToLlm: (messages) =>
      messages.filter(
        (msg): msg is PiMessage => msg.role === 'user' || msg.role === 'assistant' || msg.role === 'toolResult'
      ),
  })

  coreAgent.setSystemPrompt(systemPrompt)
  coreAgent.setTools(maxToolRounds > 0 ? tools : [])

  let history: SimpleHistoryMessage[] = []
  try {
    history = convManager.getHistoryForAgent(conversationId)
  } catch {
    // empty history on failure
  }
  coreAgent.replaceMessages(toPiHistoryMessages(history))

  onEvent({
    type: 'status',
    status: { phase: 'preparing', round: 0, toolsUsed: 0 },
  })

  // Subscribe to events
  let hasReachedToolRoundLimit = false
  const thinkingStartTime = new Map<number, number>()

  const unsubscribe = coreAgent.subscribe((event: PiAgentEvent) => {
    if (event.type === 'message_update') {
      const update = event.assistantMessageEvent
      if (update.type === 'text_delta') {
        onEvent({ type: 'content', content: update.delta })
      } else if (update.type === 'thinking_start') {
        thinkingStartTime.set(update.contentIndex, Date.now())
        onEvent({ type: 'status', status: { phase: 'thinking', round: toolRounds, toolsUsed: toolsUsed.length } })
      } else if (update.type === 'thinking_delta') {
        onEvent({ type: 'think', content: update.delta, thinkTag: 'thinking' })
      } else if (update.type === 'thinking_end') {
        const startedAt = thinkingStartTime.get(update.contentIndex)
        const durationMs = startedAt ? Date.now() - startedAt : undefined
        onEvent({ type: 'think', content: '', thinkTag: 'thinking', thinkDurationMs: durationMs })
        thinkingStartTime.delete(update.contentIndex)
      }
    } else if (event.type === 'tool_execution_start') {
      toolsUsed.push(event.toolName)
      onEvent({
        type: 'tool_start',
        toolName: event.toolName,
        toolParams: (event.args || {}) as Record<string, unknown>,
      })
      onEvent({
        type: 'status',
        status: { phase: 'tool_running', round: toolRounds, toolsUsed: toolsUsed.length, currentTool: event.toolName },
      })
    } else if (event.type === 'tool_execution_end') {
      onEvent({ type: 'tool_result', toolName: event.toolName, toolResult: event.result })
    } else if (event.type === 'turn_end') {
      if (event.toolResults.length > 0) {
        toolRounds += 1
        if (!hasReachedToolRoundLimit && maxToolRounds > 0 && toolRounds >= maxToolRounds) {
          hasReachedToolRoundLimit = true
          coreAgent.setTools([])
          coreAgent.steer({
            role: 'user',
            content: [{ type: 'text', text: 'Please provide your final answer based on the information gathered.' }],
            timestamp: Date.now(),
          } as PiMessage)
        }
      }
    } else if (event.type === 'message_end') {
      if (event.message.role === 'assistant') {
        addPiUsage(event.message.usage)
      }
    }
  })

  const forwardAbort = () => coreAgent.abort()
  if (abortSignal) {
    abortSignal.addEventListener('abort', forwardAbort, { once: true })
  }

  try {
    await coreAgent.prompt(userMessage)

    if (coreAgent.state.error) {
      onEvent({
        type: 'error',
        error: { name: 'AgentError', message: coreAgent.state.error },
      })
    }

    onEvent({ type: 'done', isFinished: true, usage: totalUsage })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    onEvent({ type: 'error', error: { name: 'AgentError', message: msg } })
    onEvent({ type: 'done', isFinished: true, usage: totalUsage })
  } finally {
    unsubscribe()
    if (abortSignal) {
      abortSignal.removeEventListener('abort', forwardAbort)
    }
  }
}
