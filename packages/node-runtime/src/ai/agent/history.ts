/**
 * History replay — converts persisted chat history into pi messages.
 *
 * Assistant messages whose content blocks carry persisted tool calls
 * (toolCallId + result) are replayed as real toolCall/toolResult message
 * pairs, so later turns see what tools were called and what they returned.
 * Persisted toolCallIds are replayed verbatim to keep requests byte-stable
 * across turns (prompt cache friendly). Legacy messages without tool data
 * fall back to plain text replay.
 *
 * When model info is provided, thinking blocks are replayed alongside tool
 * calls so APIs that require reasoning_content on tool-call turns (e.g.
 * DeepSeek) receive the original reasoning chain instead of an empty string.
 */

import type { Message as PiMessage, AssistantMessage, Usage as PiUsage } from '@earendil-works/pi-ai'
import { truncateToolResultText } from '@openchatlab/core'

import type { SimpleHistoryMessage } from './types'
import type { ContentBlock } from '../chats'

type ToolBlock = Extract<ContentBlock, { type: 'tool' }>
export type ReplayableToolBlock = ToolBlock & { tool: ToolBlock['tool'] & { toolCallId: string; result: string } }

/**
 * Model metadata attached to replayed assistant messages so pi-ai's
 * transform-messages layer treats them as same-model (preserving thinking
 * blocks in their native format instead of converting to plain text).
 */
export interface ReplayModelInfo {
  api: string
  provider: string
  id: string
}

export interface ReplayOptions {
  modelInfo?: ReplayModelInfo
  /**
   * Field name used by the provider's streaming API for reasoning content
   * (e.g. "reasoning_content" for DeepSeek). When set and the assistant
   * message contains tool calls, persisted think blocks are replayed as
   * pi-ai ThinkingContent blocks with this signature.
   */
  thinkingSignature?: string
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

export function isReplayableToolBlock(block: ContentBlock): block is ReplayableToolBlock {
  if (block.type !== 'tool') return false
  const { toolCallId, result, status } = block.tool
  return (
    typeof toolCallId === 'string' &&
    toolCallId.length > 0 &&
    typeof result === 'string' &&
    (status === 'done' || status === 'error')
  )
}

/** Drop runtime-injected params (e.g. _timeFilter) that the model never produced. */
function stripInternalParams(params?: Record<string, unknown>): Record<string, unknown> {
  if (!params) return {}
  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    if (!key.startsWith('_')) cleaned[key] = value
  }
  return cleaned
}

function makeAssistantMessage(
  content: AssistantMessage['content'],
  stopReason: 'stop' | 'toolUse',
  modelInfo?: ReplayModelInfo
): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: (modelInfo?.api ?? 'openai-completions') as AssistantMessage['api'],
    provider: modelInfo?.provider ?? 'chatlab',
    model: modelInfo?.id ?? 'unknown',
    usage: createEmptyPiUsage(),
    stopReason,
    timestamp: Date.now(),
  }
}

function replayAssistantBlocks(blocks: ContentBlock[], out: PiMessage[], options?: ReplayOptions): void {
  const { modelInfo, thinkingSignature } = options ?? {}
  const replayThinking = !!thinkingSignature && blocks.some(isReplayableToolBlock)

  let content: AssistantMessage['content'] = []

  for (const block of blocks) {
    if (block.type === 'text') {
      if (block.text.trim()) content.push({ type: 'text', text: block.text })
    } else if (block.type === 'think' && replayThinking && block.text.trim()) {
      content.push({ type: 'thinking', thinking: block.text, thinkingSignature })
    } else if (isReplayableToolBlock(block)) {
      content.push({
        type: 'toolCall',
        id: block.tool.toolCallId,
        name: block.tool.name,
        arguments: stripInternalParams(block.tool.params),
      })
      out.push(makeAssistantMessage(content, 'toolUse', modelInfo))
      out.push({
        role: 'toolResult',
        toolCallId: block.tool.toolCallId,
        toolName: block.tool.name,
        content: [{ type: 'text', text: truncateToolResultText(block.tool.result) || '(empty result)' }],
        isError: block.tool.isError ?? block.tool.status === 'error',
        timestamp: Date.now(),
      })
      content = []
    }
    // chart/plan/error/summary_meta blocks and unfinished/legacy tool blocks are not replayed
  }

  if (content.length > 0) {
    out.push(makeAssistantMessage(content, 'stop', modelInfo))
  }
}

export function toPiHistoryMessages(messages: SimpleHistoryMessage[], options?: ReplayOptions): PiMessage[] {
  const out: PiMessage[] = []

  for (const msg of messages) {
    if (msg.role === 'user') {
      out.push({
        role: 'user',
        content: [{ type: 'text', text: msg.content || '' }],
        timestamp: Date.now(),
      })
      continue
    }

    // summary 作为 assistant 消息传给 LLM（它是压缩后的上下文总结）
    const replayable = msg.role === 'assistant' && msg.contentBlocks?.some(isReplayableToolBlock)
    if (replayable) {
      replayAssistantBlocks(msg.contentBlocks!, out, options)
    } else {
      out.push(makeAssistantMessage([{ type: 'text', text: msg.content || '' }], 'stop', options?.modelInfo))
    }
  }

  return out
}
