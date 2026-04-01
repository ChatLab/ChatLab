/**
 * Agent 事件处理器
 * 管理 PiAgentCore 事件到 IPC AgentStreamChunk 的映射，
 * 以及运行时状态跟踪（usage / 工具轮次 / 状态发射）
 */

import type { AgentEvent as PiAgentEvent } from '@mariozechner/pi-agent-core'
import type { Message as PiMessage, Usage as PiUsage } from '@mariozechner/pi-ai'
import type { TokenUsage, AgentRuntimeStatus } from '../../../shared/types'
import type { ToolContext } from '../tools/types'
import type { AgentStreamChunk } from './types'

export interface EventHandlerConfig {
  onChunk: (chunk: AgentStreamChunk) => void
  context: ToolContext
  systemPrompt: string
}

/**
 * Agent 运行时状态追踪器
 * 可被 Agent 主类作为组合成员持有
 */
export class AgentEventHandler {
  readonly toolsUsed: string[] = []
  toolRounds: number = 0

  private totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  private lastStatusAt = 0
  private readonly onChunk: (chunk: AgentStreamChunk) => void
  private readonly context: ToolContext
  private readonly systemPrompt: string

  constructor(config: EventHandlerConfig) {
    this.onChunk = config.onChunk
    this.context = config.context
    this.systemPrompt = config.systemPrompt
  }

  addPiUsage(usage?: PiUsage): void {
    if (!usage) return
    this.totalUsage.promptTokens += usage.input || 0
    this.totalUsage.completionTokens += usage.output || 0
    this.totalUsage.totalTokens += usage.totalTokens || usage.input + usage.output || 0
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
    options?: {
      pendingUserMessage?: string
      currentTool?: string
      force?: boolean
    }
  ): void {
    const now = Date.now()
    if (!options?.force && now - this.lastStatusAt < 240) {
      return
    }
    this.lastStatusAt = now

    const contextTokens = this.estimateContextTokens(this.systemPrompt, messages, options?.pendingUserMessage)

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

  /**
   * 创建 PiAgentCore 事件订阅回调
   *
   * @param coreAgent PiAgentCore 实例（用于 setTools/steer）
   * @param maxToolRounds 最大工具轮数
   * @param answerWithoutToolsPrompt 触达轮次上限后注入的引导指令
   */
  createSubscriber(
    coreAgent: { state: { messages: PiMessage[] }; setTools: (t: any[]) => void; steer: (m: PiMessage) => void },
    maxToolRounds: number,
    answerWithoutToolsPrompt: string
  ): (event: PiAgentEvent) => void {
    let hasReachedToolRoundLimit = false
    const thinkingStartTime = new Map<number, number>()

    return (event: PiAgentEvent) => {
      if (event.type === 'message_update') {
        const update = event.assistantMessageEvent
        if (update.type === 'text_delta') {
          this.onChunk({ type: 'content', content: update.delta })
          this.emitStatus('responding', coreAgent.state.messages)
        } else if (update.type === 'thinking_start') {
          thinkingStartTime.set(update.contentIndex, Date.now())
          this.emitStatus('thinking', coreAgent.state.messages, { force: true })
        } else if (update.type === 'thinking_delta') {
          this.onChunk({ type: 'think', content: update.delta, thinkTag: 'thinking' })
          this.emitStatus('thinking', coreAgent.state.messages)
        } else if (update.type === 'thinking_end') {
          const startedAt = thinkingStartTime.get(update.contentIndex)
          const durationMs = startedAt ? Date.now() - startedAt : undefined
          this.onChunk({ type: 'think', content: '', thinkTag: 'thinking', thinkDurationMs: durationMs })
          thinkingStartTime.delete(update.contentIndex)
          this.emitStatus('responding', coreAgent.state.messages, { force: true })
        }
      } else if (event.type === 'tool_execution_start') {
        const params = this.normalizeToolParams(event.toolName, (event.args || {}) as Record<string, unknown>)
        this.toolsUsed.push(event.toolName)
        this.onChunk({ type: 'tool_start', toolName: event.toolName, toolParams: params })
        this.emitStatus('tool_running', coreAgent.state.messages, { currentTool: event.toolName, force: true })
      } else if (event.type === 'tool_execution_end') {
        this.onChunk({ type: 'tool_result', toolName: event.toolName, toolResult: event.result })
        this.emitStatus('thinking', coreAgent.state.messages, { force: true })
      } else if (event.type === 'turn_end') {
        if (event.toolResults.length > 0) {
          this.toolRounds += 1
          if (!hasReachedToolRoundLimit && maxToolRounds > 0 && this.toolRounds >= maxToolRounds) {
            hasReachedToolRoundLimit = true
            coreAgent.setTools([])
            coreAgent.steer({
              role: 'user',
              content: [{ type: 'text', text: answerWithoutToolsPrompt }],
              timestamp: Date.now(),
            } as PiMessage)
          }
        }
        this.emitStatus('thinking', coreAgent.state.messages, { force: true })
      } else if (event.type === 'message_end') {
        if (event.message.role === 'assistant') {
          this.addPiUsage(event.message.usage)
          this.emitStatus('responding', coreAgent.state.messages, { force: true })
        }
      }
    }
  }

  // ==================== Token 估算（内部方法） ====================

  private estimateTokensFromText(text: string): number {
    if (!text) return 0
    const normalized = text.replace(/\s+/g, ' ').trim()
    if (!normalized) return 0
    const cjkCount = (normalized.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length
    const latinCount = normalized.length - cjkCount
    return Math.max(1, Math.ceil(cjkCount * 1.15 + latinCount / 4))
  }

  private extractMessageText(message: PiMessage): string {
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

  private estimateContextTokens(systemPrompt: string, messages: PiMessage[], pendingUserMessage?: string): number {
    let tokens = this.estimateTokensFromText(systemPrompt)
    for (const message of messages) {
      tokens += this.estimateTokensFromText(this.extractMessageText(message))
    }
    if (pendingUserMessage) {
      tokens += this.estimateTokensFromText(pendingUserMessage)
    }
    return tokens
  }
}
