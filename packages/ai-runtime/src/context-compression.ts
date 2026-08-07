import { getBuiltinModelById } from '@openchatlab/core'
import { generateText } from 'ai'

import type { RunAgentInput, RuntimeContextSummary, RuntimeMessage } from './types'

// OpenAI-compatible endpoints do not expose standard context-window metadata.
// Underestimating an unknown model compresses earlier; overestimating it makes
// the provider reject an otherwise recoverable conversation.
const DEFAULT_CONTEXT_WINDOW = 8_192
const COMPRESSION_THRESHOLD_PERCENT = 75
const BUFFER_SIZE_PERCENT = 20
const COMPRESSION_SAFETY_PERCENT = 5
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
  const fallbackMessages = (): RuntimeMessage[] =>
    fitMessagesWithinTokenBudget(effectiveMessages, thresholdTokens, input.systemPrompt, input.userMessage)

  input.onEvent({ type: 'context-compression-start' })
  let compressed = false
  try {
    const maxOutputTokens = Math.max(64, Math.min(MAX_SUMMARY_TOKENS, Math.floor(contextWindow * 0.1)))
    const safetyTokens = Math.max(1, Math.floor(contextWindow * (COMPRESSION_SAFETY_PERCENT / 100)))
    const promptTokenBudget = Math.max(1, contextWindow - maxOutputTokens - safetyTokens)
    let content = summary?.content ?? null
    let offset = 0

    while (offset < messagesToCompress.length) {
      const stage = createCompressionStage(content, messagesToCompress.slice(offset), promptTokenBudget)
      if (stage.messageCount === 0) return fallbackMessages()
      const result = await generateText({
        model: input.model.model,
        prompt: stage.prompt,
        maxOutputTokens,
        abortSignal: input.signal,
      })
      content = result.text.trim()
      if (!content) return fallbackMessages()
      offset += stage.messageCount
    }
    if (!content) return fallbackMessages()

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
    return fallbackMessages()
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

function createCompressionStage(
  previousSummary: string | null,
  messages: RuntimeMessage[],
  promptTokenBudget: number
): { prompt: string; messageCount: number } {
  const maxPromptBytes = promptTokenBudget * 3
  const minimumMessageBytes = textEncoder.encode('[ASSISTANT]\n.').byteLength
  const summary = fitSummaryWithinPromptBudget(previousSummary, maxPromptBytes - minimumMessageBytes)
  const basePrompt = COMPRESSION_PROMPT.replace('{history}', formatCompressionHistory(summary, []))
  let usedBytes = textEncoder.encode(basePrompt).byteLength
  if (usedBytes >= maxPromptBytes) return { prompt: basePrompt, messageCount: 0 }

  const fragments: string[] = []
  for (const message of messages) {
    const prefix = `${fragments.length === 0 ? '' : '\n\n'}[${message.role.toUpperCase()}]\n`
    const fragment = `${prefix}${message.content}`
    const fragmentBytes = textEncoder.encode(fragment).byteLength
    if (usedBytes + fragmentBytes <= maxPromptBytes) {
      fragments.push(fragment)
      usedBytes += fragmentBytes
      continue
    }
    if (fragments.length > 0) break

    const marker = '\n[TRUNCATED TO FIT MODEL CONTEXT]'
    const prefixBytes = textEncoder.encode(prefix).byteLength
    const markerBytes = textEncoder.encode(marker).byteLength
    const contentByteBudget = maxPromptBytes - usedBytes - prefixBytes
    if (contentByteBudget <= 0) break
    const canIncludeMarker = contentByteBudget > markerBytes
    const boundedContent = truncateTextToByteBudget(
      message.content,
      contentByteBudget - (canIncludeMarker ? markerBytes : 0)
    )
    fragments.push(`${prefix}${boundedContent}${canIncludeMarker ? marker : ''}`)
    break
  }

  return { prompt: `${basePrompt}${fragments.join('')}`, messageCount: fragments.length }
}

function fitSummaryWithinPromptBudget(summary: string | null, maxPromptBytes: number): string | null {
  if (!summary) return null
  const promptBytes = (content: string): number =>
    textEncoder.encode(COMPRESSION_PROMPT.replace('{history}', formatCompressionHistory(content, []))).byteLength
  if (promptBytes(summary) <= maxPromptBytes) return summary

  let low = 0
  let high = summary.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (promptBytes(summary.slice(0, middle)) <= maxPromptBytes) low = middle
    else high = middle - 1
  }
  if (low > 0 && /[\uD800-\uDBFF]/.test(summary[low - 1])) low -= 1
  return summary.slice(0, low)
}

function fitMessagesWithinTokenBudget(
  messages: RuntimeMessage[],
  tokenBudget: number,
  systemPrompt: string,
  userMessage: string
): RuntimeMessage[] {
  let remainingTokens = Math.max(0, tokenBudget - estimateTextTokens(systemPrompt) - estimateTextTokens(userMessage))
  const result: RuntimeMessage[] = []

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    const messageTokens = estimateMessageTokens(message)
    if (messageTokens <= remainingTokens) {
      result.push(message)
      remainingTokens -= messageTokens
      continue
    }
    if (result.length === 0 && remainingTokens > 4) {
      const content = truncateTextToByteBudget(message.content, (remainingTokens - 4) * 3)
      if (content) result.push({ ...message, content })
    }
    break
  }

  return result.reverse()
}

function truncateTextToByteBudget(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  if (textEncoder.encode(text).byteLength <= maxBytes) return text

  let low = 0
  let high = text.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (textEncoder.encode(text.slice(0, middle)).byteLength <= maxBytes) low = middle
    else high = middle - 1
  }
  if (low > 0 && /[\uD800-\uDBFF]/.test(text[low - 1])) low -= 1
  return text.slice(0, low)
}

function formatCompressionHistory(summary: string | null, messages: RuntimeMessage[]): string {
  const sections: string[] = []
  if (summary) sections.push(`[PREVIOUS SUMMARY]\n${summary}`)
  sections.push(
    `[MESSAGES]\n${messages.map((message) => `[${message.role.toUpperCase()}]\n${message.content}`).join('\n\n')}`
  )
  return sections.join('\n\n')
}
