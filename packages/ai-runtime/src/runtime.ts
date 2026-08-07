import type { ModelMessage, ToolSet } from 'ai'
import { jsonSchema, stepCountIs, streamText, tool } from 'ai'

import { normalizeRuntimeError } from './errors'
import { prepareContextMessages } from './context-compression'
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

const MAX_TOOL_RESULT_CHARACTERS = 24_000

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`
}

function toModelMessages(messages: RuntimeMessage[], userMessage: string): ModelMessage[] {
  const result: ModelMessage[] = messages.map((message) => ({
    role: message.role,
    content: message.content,
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
  if (result.evidence !== undefined) {
    blocks.push({ type: 'evidence', payload: result.evidence })
    onEvent({ type: 'evidence', payload: result.evidence })
  }
}

function appendTextDelta(blocks: RuntimeContentBlock[], type: 'text' | 'reasoning', delta: string): void {
  if (!delta) return
  const last = blocks.at(-1)
  if (last?.type === type) last.text += delta
  else blocks.push({ type, text: delta })
}

function toStoredToolResult(result: RuntimeToolResult): RuntimeToolResult {
  // Structured display payloads are persisted as dedicated blocks below, so keep the tool block bounded.
  return {
    content: result.content,
    ...(result.truncated ? { truncated: true } : {}),
  }
}

export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const requestId = input.requestId ?? createId('request')
  const assistantMessageId = input.messageId ?? createId('message')
  input.onEvent({ type: 'start', requestId, messageId: assistantMessageId })

  try {
    const storedMessages = await input.repository.getMessages(input.conversationId)
    const contextMessages = await prepareContextMessages(input, storedMessages)

    const blocks: RuntimeContentBlock[] = []
    const toolsUsed = new Set<string>()
    const toolSet: ToolSet = Object.fromEntries(
      input.tools.listTools().map((definition) => [
        definition.name,
        tool({
          description: definition.description,
          inputSchema: jsonSchema(definition.inputSchema as Parameters<typeof jsonSchema>[0]),
          // UI needs the structured payload, while the model only needs the bounded textual result.
          toModelOutput: ({ output }) => ({ type: 'text', value: output.content }),
          execute: async (toolInput, options) => {
            toolsUsed.add(definition.name)
            const toolBlock: Extract<RuntimeContentBlock, { type: 'tool' }> = {
              type: 'tool',
              callId: options.toolCallId,
              name: definition.name,
              input: toolInput,
            }
            blocks.push(toolBlock)
            input.onEvent({ type: 'tool-start', callId: options.toolCallId, name: definition.name, input: toolInput })
            try {
              const rawResult = await input.tools.execute(
                definition.name,
                toolInput,
                { sessionId: input.sessionId, conversationId: input.conversationId },
                input.signal
              )
              const limited = truncateToolResult(rawResult.content, MAX_TOOL_RESULT_CHARACTERS)
              const result = {
                ...rawResult,
                content: limited.content,
                truncated: rawResult.truncated || limited.truncated,
              }
              const storedResult = toStoredToolResult(result)
              toolBlock.result = storedResult
              toolBlock.isError = result.isError
              input.onEvent({
                type: 'tool-result',
                callId: options.toolCallId,
                name: definition.name,
                result: storedResult,
                isError: result.isError === true,
              })
              appendResultBlocks(result, blocks, input.onEvent)
              return result
            } catch (error) {
              const result = { content: error instanceof Error ? error.message : String(error) }
              toolBlock.result = result
              toolBlock.isError = true
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
    let aborted = false
    let finalReason: string | undefined
    const result = streamText({
      model: input.model.model,
      instructions: input.systemPrompt,
      messages: toModelMessages(contextMessages, input.userMessage),
      tools: toolSet,
      stopWhen: stepCountIs(input.maxToolSteps ?? 8),
      maxOutputTokens: input.maxOutputTokens ?? 4_096,
      abortSignal: input.signal,
      onError: () => undefined,
    })

    for await (const part of result.stream) {
      if (part.type === 'text-delta') {
        text += part.text
        appendTextDelta(blocks, 'text', part.text)
        input.onEvent({ type: 'text-delta', delta: part.text })
      } else if (part.type === 'reasoning-delta') {
        appendTextDelta(blocks, 'reasoning', part.text)
        input.onEvent({ type: 'reasoning-delta', delta: part.text })
      } else if (part.type === 'finish') {
        finalReason = part.finishReason
      } else if (part.type === 'abort') {
        aborted = true
      } else if (part.type === 'error' && !input.signal.aborted) {
        throw part.error
      }
    }

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
    return { message, usage, finishReason, toolsUsed: [...toolsUsed] }
  } catch (error) {
    const normalized = normalizeRuntimeError(error, input.signal)
    input.onEvent({ type: 'error', error: normalized.toJSON() })
    if (normalized.code === 'ABORTED') input.onEvent({ type: 'finish', reason: 'aborted' })
    throw normalized
  }
}
