import { getBuiltinModelById } from '@openchatlab/core'
import { generateText } from 'ai'

import type { RunAgentInput, RuntimeContextSummary, RuntimeMessage } from './types'

// OpenAI-compatible endpoints do not expose standard context-window metadata.
// Underestimating an unknown model compresses earlier; overestimating it makes
// the provider reject an otherwise recoverable conversation.
const DEFAULT_CONTEXT_WINDOW = 8_192
const COMPRESSION_THRESHOLD_PERCENT = 75
const BUFFER_SIZE_PERCENT = 20
const MAX_SUMMARY_TOKENS = 4_096
const textEncoder = new TextEncoder()

const COMPRESSION_PROMPT = `You are compressing a long AI conversation so it can continue within the model context window.

Return only a concise structured summary in the same language as the conversation.
Preserve important facts, conclusions, user preferences, names, dates, unresolved questions, and next actions.
Merge the previous summary when present. Do not copy long passages verbatim.

{history}`

export function resolveRuntimeContextWindow(providerId: string, modelId: string): number {
  return getBuiltinModelById(providerId, modelId)?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
}

export async function prepareContextMessages(
  input: RunAgentInput,
  storedMessages: RuntimeMessage[]
): Promise<RuntimeMessage[]> {
  const previousSummary = await input.repository.getContextSummary(input.conversationId)
  const { summary, recentMessages } = resolveCurrentHistory(storedMessages, previousSummary)
  const effectiveMessages = summary ? [toSummaryMessage(summary), ...recentMessages] : recentMessages
  const contextWindow = input.model.contextWindow ?? DEFAULT_CONTEXT_WINDOW
  const thresholdTokens = Math.floor(contextWindow * (COMPRESSION_THRESHOLD_PERCENT / 100))
  const currentTokens = estimateMessagesTokens(effectiveMessages, input.systemPrompt, input.userMessage)

  if (currentTokens < thresholdTokens || recentMessages.length === 0) return effectiveMessages

  const bufferTokenBudget = Math.floor(contextWindow * (BUFFER_SIZE_PERCENT / 100))
  const { bufferMessages, messagesToCompress } = splitMessages(recentMessages, bufferTokenBudget)
  if (messagesToCompress.length === 0) return effectiveMessages

  input.onEvent({ type: 'context-compression-start' })
  let compressed = false
  try {
    const history = formatCompressionHistory(summary, messagesToCompress)
    const maxOutputTokens = Math.max(64, Math.min(MAX_SUMMARY_TOKENS, Math.floor(contextWindow * 0.1)))
    const result = await generateText({
      model: input.model.model,
      prompt: COMPRESSION_PROMPT.replace('{history}', history),
      maxOutputTokens,
      abortSignal: input.signal,
    })
    const content = result.text.trim()
    if (!content) return effectiveMessages

    const boundaryMessageId = messagesToCompress.at(-1)!.id
    const nextSummary = await input.repository.saveContextSummary({
      conversationId: input.conversationId,
      content,
      boundaryMessageId,
      compressedMessageCount: (summary?.compressedMessageCount ?? 0) + messagesToCompress.length,
    })
    compressed = true
    return [toSummaryMessage(nextSummary), ...bufferMessages]
  } catch (error) {
    if (input.signal.aborted) throw error
    return effectiveMessages
  } finally {
    input.onEvent({ type: 'context-compression-finish', compressed })
  }
}

function resolveCurrentHistory(
  messages: RuntimeMessage[],
  summary: RuntimeContextSummary | null
): { summary: RuntimeContextSummary | null; recentMessages: RuntimeMessage[] } {
  if (!summary) return { summary: null, recentMessages: messages }
  const boundaryIndex = messages.findIndex((message) => message.id === summary.boundaryMessageId)
  if (boundaryIndex < 0) return { summary: null, recentMessages: messages }
  return { summary, recentMessages: messages.slice(boundaryIndex + 1) }
}

function toSummaryMessage(summary: RuntimeContextSummary): RuntimeMessage {
  return {
    id: `context-summary:${summary.conversationId}`,
    conversationId: summary.conversationId,
    role: 'assistant',
    content: summary.content,
    createdAt: summary.updatedAt,
  }
}

function splitMessages(
  messages: RuntimeMessage[],
  bufferTokenBudget: number
): { bufferMessages: RuntimeMessage[]; messagesToCompress: RuntimeMessage[] } {
  let bufferTokens = 0
  let splitIndex = messages.length
  for (let index = messages.length - 1; index >= 0; index--) {
    const messageTokens = estimateMessageTokens(messages[index])
    if (bufferTokens + messageTokens > bufferTokenBudget) {
      splitIndex = index + 1
      break
    }
    bufferTokens += messageTokens
    if (index === 0) splitIndex = 0
  }
  return {
    bufferMessages: messages.slice(splitIndex),
    messagesToCompress: messages.slice(0, splitIndex),
  }
}

function estimateMessagesTokens(messages: RuntimeMessage[], systemPrompt: string, userMessage: string): number {
  return (
    estimateTextTokens(systemPrompt) +
    estimateTextTokens(userMessage) +
    messages.reduce((total, message) => total + estimateMessageTokens(message), 0)
  )
}

function estimateMessageTokens(message: RuntimeMessage): number {
  return estimateTextTokens(message.content) + 4
}

function estimateTextTokens(text: string): number {
  // UTF-8 bytes / 3 is deliberately conservative for mixed Chinese and Latin
  // text while keeping this browser runtime free of a tokenizer dependency.
  return Math.ceil(textEncoder.encode(text).byteLength / 3)
}

function formatCompressionHistory(summary: RuntimeContextSummary | null, messages: RuntimeMessage[]): string {
  const sections: string[] = []
  if (summary) sections.push(`[PREVIOUS SUMMARY]\n${summary.content}`)
  sections.push(
    `[MESSAGES]\n${messages.map((message) => `[${message.role.toUpperCase()}]\n${message.content}`).join('\n\n')}`
  )
  return sections.join('\n\n')
}
