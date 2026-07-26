import type { ModelMessage, ToolSet } from 'ai'
import { jsonSchema, stepCountIs, streamText, tool } from 'ai'

import { compressConversation, resolveCompressionPolicy } from './context-compression'
import { normalizeRuntimeError } from './errors'
import { truncateToolResult } from './token-budget'
import type {
  AgentStreamEvent,
  FinishReason,
  RunAgentInput,
  RunAgentResult,
  RuntimeContentBlock,
  RuntimeMessage,
  RuntimeToolResult,
  TokenUsage,
} from './types'

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`
}

function toModelMessages(messages: RuntimeMessage[], userMessage: string): ModelMessage[] {
  const result: ModelMessage[] = messages.map((message) => ({
    role: message.role === 'summary' ? 'assistant' : message.role,
    content: message.role === 'summary' ? `[Conversation summary]\n${message.content}` : message.content,
  }))
  result.push({ role: 'user', content: userMessage })
  return result
}

function mapFinishReason(reason: string | undefined, aborted: boolean): FinishReason {
  if (aborted) return 'aborted'
  if (reason === 'stop' || reason === 'length' || reason === 'content-filter' || reason === 'tool-calls') return reason
  if (reason === 'error') return 'error'
  return 'unknown'
}

function mapUsage(usage: {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number }
  outputTokenDetails?: { reasoningTokens?: number }
}): TokenUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens,
    cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens,
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
  }
}

function appendResultBlocks(
  result: RuntimeToolResult,
  blocks: RuntimeContentBlock[],
  onEvent: (event: AgentStreamEvent) => void
): void {
  if (result.chart !== undefined) {
    blocks.push({ type: 'chart', payload: result.chart })
    onEvent({ type: 'chart', payload: result.chart })
  }
  if (result.evidence !== undefined) {
    blocks.push({ type: 'evidence', payload: result.evidence })
    onEvent({ type: 'evidence', payload: result.evidence })
  }
}

export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const requestId = input.requestId ?? createId('request')
  const assistantMessageId = input.messageId ?? createId('message')
  const policy = resolveCompressionPolicy(input.compression)
  input.onEvent({ type: 'start', requestId, messageId: assistantMessageId })

  try {
    const storedMessages = await input.repository.getMessages(input.conversationId)
    const prepared = await compressConversation({
      conversationId: input.conversationId,
      messages: storedMessages,
      model: input.model,
      repository: input.repository,
      systemPrompt: input.systemPrompt,
      signal: input.signal,
      policy,
      onEvent: input.onEvent,
    })

    const blocks: RuntimeContentBlock[] = []
    const toolsUsed = new Set<string>()
    const toolSet: ToolSet = Object.fromEntries(
      input.tools.listTools().map((definition) => [
        definition.name,
        tool({
          description: definition.description,
          inputSchema: jsonSchema(definition.inputSchema as Parameters<typeof jsonSchema>[0]),
          execute: async (toolInput, options) => {
            toolsUsed.add(definition.name)
            input.onEvent({ type: 'tool-start', callId: options.toolCallId, name: definition.name, input: toolInput })
            try {
              const rawResult = await input.tools.execute(
                definition.name,
                toolInput,
                { sessionId: input.sessionId, conversationId: input.conversationId },
                input.signal
              )
              const limited = truncateToolResult(rawResult.content, policy.maxToolResultCharacters)
              const result = {
                ...rawResult,
                content: limited.content,
                truncated: rawResult.truncated || limited.truncated,
              }
              blocks.push({ type: 'tool', callId: options.toolCallId, name: definition.name, input: toolInput, result })
              input.onEvent({
                type: 'tool-result',
                callId: options.toolCallId,
                name: definition.name,
                result,
                isError: false,
              })
              appendResultBlocks(result, blocks, input.onEvent)
              return result
            } catch (error) {
              const result = { content: error instanceof Error ? error.message : String(error) }
              blocks.push({
                type: 'tool',
                callId: options.toolCallId,
                name: definition.name,
                input: toolInput,
                result,
                isError: true,
              })
              input.onEvent({
                type: 'tool-result',
                callId: options.toolCallId,
                name: definition.name,
                result,
                isError: true,
              })
              return result
            }
          },
        }),
      ])
    )

    let text = ''
    let reasoning = ''
    let aborted = false
    let finalReason: string | undefined
    const result = streamText({
      model: input.model.model,
      instructions: input.systemPrompt,
      messages: toModelMessages(prepared.messages, input.userMessage),
      tools: toolSet,
      stopWhen: stepCountIs(input.maxToolSteps ?? 8),
      maxOutputTokens: input.maxOutputTokens ?? 4_096,
      abortSignal: input.signal,
      onError: () => undefined,
    })

    for await (const part of result.stream) {
      if (part.type === 'text-delta') {
        text += part.text
        input.onEvent({ type: 'text-delta', delta: part.text })
      } else if (part.type === 'reasoning-delta') {
        reasoning += part.text
        input.onEvent({ type: 'reasoning-delta', delta: part.text })
      } else if (part.type === 'finish') {
        finalReason = part.finishReason
      } else if (part.type === 'abort') {
        aborted = true
      } else if (part.type === 'error' && !input.signal.aborted) {
        throw part.error
      }
    }

    if (reasoning) blocks.unshift({ type: 'reasoning', text: reasoning })
    if (text) blocks.push({ type: 'text', text })
    let usage: TokenUsage = {}
    try {
      usage = mapUsage(await result.usage)
    } catch (error) {
      if (!input.signal.aborted) throw error
      aborted = true
    }
    input.onEvent({ type: 'usage', usage })
    const finishReason = mapFinishReason(finalReason, aborted || input.signal.aborted)
    const message = await input.repository.appendMessage({
      id: assistantMessageId,
      conversationId: input.conversationId,
      role: 'assistant',
      content: text,
      blocks,
      usage,
    })
    input.onEvent({ type: 'finish', reason: finishReason })
    return { message, usage, finishReason, toolsUsed: [...toolsUsed], compressed: prepared.compressed }
  } catch (error) {
    const normalized = normalizeRuntimeError(error, input.signal)
    input.onEvent({ type: 'error', error: normalized.toJSON() })
    if (normalized.code === 'ABORTED') input.onEvent({ type: 'finish', reason: 'aborted' })
    throw normalized
  }
}
