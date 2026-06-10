/**
 * Agent event handler — shared implementation.
 *
 * Maps AgentCoreEvent → stream chunks, tracks usage/tool rounds,
 * estimates context tokens. Platform-agnostic via generic chunk type.
 */

import type { Message as PiMessage } from '@earendil-works/pi-ai'
import type { AgentCoreEvent } from './types'
import type { PlanContentBlock } from './planning-types'
import type { RouteDecision } from './routing-types'

// ==================== Shared types ====================

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface AgentRuntimeStatus {
  phase: 'compressing' | 'preparing' | 'thinking' | 'tool_running' | 'responding' | 'completed' | 'aborted' | 'error'
  round: number
  toolsUsed: number
  currentTool?: string
  contextTokens: number
  totalUsage: TokenUsage
  updatedAt: number
}

export interface AgentStreamChunk {
  type:
    | 'content'
    | 'think'
    | 'tool_start'
    | 'tool_result'
    | 'status'
    | 'compression_done'
    | 'route'
    | 'plan_delta'
    | 'plan'
    | 'plan_skipped'
    | 'done'
    | 'error'
  content?: string
  thinkTag?: string
  thinkDurationMs?: number
  toolCallId?: string
  toolName?: string
  toolParams?: Record<string, unknown>
  toolResult?: unknown
  toolIsError?: boolean
  error?: unknown
  isFinished?: boolean
  usage?: TokenUsage
  status?: AgentRuntimeStatus
  routeDecision?: RouteDecision
  planDelta?: string
  plan?: PlanContentBlock
  compressionResult?: {
    summaryContent: string
    tokensBefore: number
    tokensAfter: number
    timestamp: number
  }
}

export interface EventHandlerContext {
  maxMessagesLimit?: number
  timeFilter?: { startTs: number; endTs: number }
}

export interface EventHandlerConfig {
  onChunk: (chunk: AgentStreamChunk) => void
  context: EventHandlerContext
  systemPrompt: string
}

// ==================== Token estimation ====================

function estimateTokensFromText(text: string): number {
  if (!text) return 0
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return 0
  const cjkCount = (normalized.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length
  const latinCount = normalized.length - cjkCount
  return Math.max(1, Math.ceil(cjkCount * 1.15 + latinCount / 4))
}

function extractMessageText(message: PiMessage): string {
  if (message.role === 'user') {
    if (typeof message.content === 'string') return message.content
    return message.content
      .map((item) => {
        if (item.type === 'text') return item.text
        if (item.type === 'image') return '[image]'
        return ''
      })
      .join('\n')
  }

  if (message.role === 'assistant') {
    return message.content
      .map((item) => {
        if (item.type === 'text') return item.text
        if (item.type === 'thinking') return item.thinking
        if (item.type === 'toolCall') return `${item.name} ${JSON.stringify(item.arguments || {})}`
        return ''
      })
      .join('\n')
  }

  if (message.role === 'toolResult') {
    return message.content
      .map((item) => {
        if (item.type === 'text') return item.text
        return '[binary]'
      })
      .join('\n')
  }

  return ''
}

function estimateContextTokens(systemPrompt: string, messages: PiMessage[], pendingUserMessage?: string): number {
  let tokens = estimateTokensFromText(systemPrompt)
  for (const message of messages) {
    if (message.role === 'toolResult') continue
    tokens += estimateTokensFromText(extractMessageText(message))
  }
  if (pendingUserMessage) {
    tokens += estimateTokensFromText(pendingUserMessage)
  }
  return tokens
}

// Exported for unit testing
export { estimateTokensFromText }

// ==================== Event handler class ====================

export class AgentEventHandler {
  readonly toolsUsed: string[] = []
  toolRounds: number = 0

  private totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  private lastStatusAt = 0
  private readonly onChunk: (chunk: AgentStreamChunk) => void
  private readonly context: EventHandlerContext
  private readonly systemPrompt: string

  constructor(config: EventHandlerConfig) {
    this.onChunk = config.onChunk
    this.context = config.context
    this.systemPrompt = config.systemPrompt
  }

  handleCoreEvent(event: AgentCoreEvent, messages: PiMessage[]): void {
    switch (event.type) {
      case 'content':
        this.onChunk({ type: 'content', content: event.content })
        this.emitStatus('responding', messages)
        break
      case 'thinking_start':
        this.emitStatus('thinking', messages, { force: true })
        break
      case 'thinking_delta':
        this.onChunk({ type: 'think', content: event.content, thinkTag: 'thinking' })
        this.emitStatus('thinking', messages)
        break
      case 'thinking_end':
        this.onChunk({ type: 'think', content: '', thinkTag: 'thinking', thinkDurationMs: event.durationMs })
        this.emitStatus('responding', messages, { force: true })
        break
      case 'tool_start': {
        const params = this.normalizeToolParams(event.toolName, event.toolParams)
        this.toolsUsed.push(event.toolName)
        this.onChunk({ type: 'tool_start', toolCallId: event.toolCallId, toolName: event.toolName, toolParams: params })
        this.emitStatus('tool_running', messages, { currentTool: event.toolName, force: true })
        break
      }
      case 'tool_end':
        this.onChunk({
          type: 'tool_result',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          toolResult: event.toolResult,
          toolIsError: event.isError,
        })
        this.emitStatus('thinking', messages, { force: true })
        break
      case 'turn_end':
        this.toolRounds = event.round
        this.emitStatus('thinking', messages, { force: true })
        break
      case 'usage_update':
        this.totalUsage = { ...event.usage }
        this.emitStatus('responding', messages, { force: true })
        break
    }
  }

  cloneUsage(): TokenUsage {
    return {
      promptTokens: this.totalUsage.promptTokens,
      completionTokens: this.totalUsage.completionTokens,
      totalTokens: this.totalUsage.totalTokens,
    }
  }

  emitStatus(
    phase: AgentRuntimeStatus['phase'],
    messages: PiMessage[],
    options?: { pendingUserMessage?: string; currentTool?: string; force?: boolean }
  ): void {
    const now = Date.now()
    if (!options?.force && now - this.lastStatusAt < 240) return
    this.lastStatusAt = now

    const contextTokens = estimateContextTokens(this.systemPrompt, messages, options?.pendingUserMessage)
    const status: AgentRuntimeStatus = {
      phase,
      round: this.toolRounds,
      toolsUsed: this.toolsUsed.length,
      currentTool: options?.currentTool,
      contextTokens,
      totalUsage: this.cloneUsage(),
      updatedAt: now,
    }
    this.onChunk({ type: 'status', status })
  }

  normalizeToolParams(toolName: string, params: Record<string, unknown>): Record<string, unknown> {
    const normalized = { ...params }
    const toolsWithLimit = ['search_messages', 'get_recent_messages', 'get_conversation_between']
    if (this.context.maxMessagesLimit && toolsWithLimit.includes(toolName)) {
      normalized.limit = this.context.maxMessagesLimit
    }
    if (this.context.timeFilter && (toolName === 'search_messages' || toolName === 'get_recent_messages')) {
      normalized._timeFilter = this.context.timeFilter
    }
    return normalized
  }
}
