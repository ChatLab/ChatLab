/**
 * Agent Core 共享类型
 *
 * 定义 runAgentCore 的输入/输出/事件接口，
 * 供 Server 和 Electron 两端通过 DI 适配。
 */

import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { Model, Api, Message } from '@earendil-works/pi-ai'
import type { ThinkingLevel } from '@openchatlab/core'
import type { ContentBlock } from '../chats'

export interface AgentTokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface SimpleHistoryMessage {
  role: 'user' | 'assistant' | 'summary'
  content: string
  /** Persisted content blocks; tool blocks with toolCallId+result are replayed as real toolCall/toolResult pairs. */
  contentBlocks?: ContentBlock[]
}

export type AgentCoreEvent =
  | { type: 'content'; content: string }
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; content: string }
  | { type: 'thinking_end'; durationMs?: number }
  | { type: 'tool_start'; toolCallId: string; toolName: string; toolParams: Record<string, unknown> }
  | { type: 'tool_end'; toolCallId: string; toolName: string; toolResult: unknown; isError: boolean }
  | { type: 'turn_end'; round: number; hadToolCalls: boolean }
  | { type: 'usage_update'; usage: AgentTokenUsage }

export interface AgentCoreOptions {
  piModel: Model<Api>
  apiKey: string
  systemPrompt: string
  tools: AgentTool[]
  history: SimpleHistoryMessage[]
  userMessage: string
  maxToolRounds?: number
  abortSignal?: AbortSignal
  steerMessage?: string
  /** Override the thinking level for this request. Clamped to what the model supports. */
  thinkingLevel?: ThinkingLevel
  onEvent: (event: AgentCoreEvent) => void
  /**
   * 自定义 stream 函数，默认使用 pi-ai 的 streamSimple。
   * Electron 可传入包装版以捕获 onPayload 用于错误诊断。
   */
  streamFn?: unknown
  /** 每次 convertToLlm 执行后回调，供 Electron debug 日志使用 */
  onConvertToLlm?: (filteredMessages: Message[]) => void
  /** 执行前回调完整的调试上下文（system prompt + history + user message） */
  onDebugContext?: (messages: Array<{ role: string; content: string }>) => void
}

export interface AgentCoreResult {
  usage: AgentTokenUsage
  error?: string
  finalMessages: Message[]
  toolsUsed: string[]
  toolRounds: number
}
