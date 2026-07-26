import { generateText } from 'ai'

import { AiRuntimeError, normalizeRuntimeError } from './errors'
import { estimateMessageTokens } from './token-budget'
import type { AgentStreamEvent, CompressionPolicy, ConversationRepository, RuntimeMessage, RuntimeModel } from './types'

export const DEFAULT_COMPRESSION_POLICY: CompressionPolicy = {
  thresholdRatio: 0.7,
  recentBufferRatio: 0.2,
  maxSummaryTokens: 8_192,
  minMessages: 3,
  maxToolResultCharacters: 24_000,
}

export function resolveCompressionPolicy(input?: Partial<CompressionPolicy>): CompressionPolicy {
  return { ...DEFAULT_COMPRESSION_POLICY, ...input }
}

export function selectCompressionMessages(
  messages: RuntimeMessage[],
  model: RuntimeModel,
  policy: CompressionPolicy,
  systemPrompt: string
): { shouldCompress: boolean; oldMessages: RuntimeMessage[]; recentMessages: RuntimeMessage[]; tokens: number } {
  const tokens =
    Math.ceil(systemPrompt.length / 4) +
    messages.reduce((sum, message) => sum + estimateMessageTokens(message, policy.maxToolResultCharacters), 0)
  if (tokens < model.contextWindow * policy.thresholdRatio) {
    return { shouldCompress: false, oldMessages: [], recentMessages: messages, tokens }
  }

  const recentBudget = model.contextWindow * policy.recentBufferRatio
  let recentTokens = 0
  let splitAt = messages.length
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const next = estimateMessageTokens(messages[index]!, policy.maxToolResultCharacters)
    if (recentTokens + next > recentBudget) break
    recentTokens += next
    splitAt = index
  }
  const oldMessages = messages.slice(0, splitAt)
  return {
    shouldCompress: oldMessages.filter((message) => message.role !== 'summary').length >= policy.minMessages,
    oldMessages,
    recentMessages: messages.slice(splitAt),
    tokens,
  }
}

function formatCompressionInput(messages: RuntimeMessage[]): string {
  return messages
    .map(
      (message) =>
        `${message.role === 'user' ? 'User' : message.role === 'summary' ? 'Previous summary' : 'Assistant'}: ${message.content}`
    )
    .join('\n\n')
}

export async function compressConversation(input: {
  conversationId: string
  messages: RuntimeMessage[]
  model: RuntimeModel
  repository: ConversationRepository
  systemPrompt: string
  signal: AbortSignal
  policy: CompressionPolicy
  onEvent: (event: AgentStreamEvent) => void
}): Promise<{ messages: RuntimeMessage[]; compressed: boolean }> {
  const selected = selectCompressionMessages(input.messages, input.model, input.policy, input.systemPrompt)
  if (!selected.shouldCompress) return { messages: input.messages, compressed: false }

  input.onEvent({ type: 'compression-start' })
  try {
    const result = await generateText({
      model: input.model.model,
      abortSignal: input.signal,
      maxOutputTokens: Math.min(input.policy.maxSummaryTokens, Math.floor(input.model.contextWindow * 0.1)),
      prompt: `Compress the following AI conversation into a concise progressive summary. Preserve prior summary facts, decisions, user preferences, names, dates, data and unresolved tasks. Paraphrase; never copy long messages verbatim. Use the conversation language. Output only the summary.\n\n${formatCompressionInput(selected.oldMessages)}`,
    })
    const boundary = selected.recentMessages[0]?.id ?? selected.oldMessages.at(-1)!.id
    const summary = await input.repository.replaceSummary(input.conversationId, {
      content: result.text,
      boundaryMessageId: boundary,
    })
    input.onEvent({ type: 'compression-done', summaryMessageId: summary.id })
    return { messages: [summary, ...selected.recentMessages], compressed: true }
  } catch (error) {
    const normalized = normalizeRuntimeError(error, input.signal)
    if (normalized.code === 'ABORTED') throw normalized
    // Compression failure must never mutate or remove the original history.
    if (error instanceof AiRuntimeError && error.code === 'CONTEXT_TOO_LARGE') throw error
    return { messages: input.messages, compressed: false }
  }
}
