/**
 * 上下文压缩核心逻辑（平台无关）
 *
 * 通过 CompressionLlmAdapter 抽象 LLM 调用，
 * 通过 AIChatManager 操作对话数据。
 */

import { countTokens, countMessagesTokens } from '../tokenizer'
import type { AIChatManager, ContentBlock, AIMessageRole } from '../chats'
import type { CompressionConfig, CompressionResult, CompressionLogger, CompressionLlmAdapter } from './types'

const DEFAULT_CONTEXT_WINDOW = 128000

const INITIAL_COMPRESSION_PROMPT = `You are a context compression assistant. Compress the conversation below into a structured summary.

STRICT RULES:
- Output ONLY the summary content. No greetings, no preamble, no meta-commentary, no word/token counts.
- Use the same language as the conversation.
- Maximum output length: {maxTokens} tokens. Be concise.
- NEVER reproduce any single message verbatim. Always paraphrase and compress.
- Cover ALL topics discussed — no single topic should exceed 30% of the summary.
- Organize by topic/thread, using brief headers (e.g. "## Topic").
- Preserve: key facts, conclusions, user preferences, data points, names, important timestamps, action items.
- Omit: pleasantries, filler, redundant back-and-forth, detailed tables (summarize their conclusions instead).

CONVERSATION:
{messages}`

const PROGRESSIVE_COMPRESSION_PROMPT = `You are a context compression assistant performing an INCREMENTAL summary update.

You will receive:
1. A [PREVIOUS SUMMARY] — this represents the compressed history of earlier conversation. Its content MUST be preserved in your output.
2. [NEW MESSAGES] — recent messages that need to be merged into the summary.

STRICT RULES:
- Output ONLY the updated summary. No greetings, no preamble, no meta-commentary.
- Use the same language as the conversation.
- Maximum output length: {maxTokens} tokens. Be concise.
- CRITICAL: You MUST retain ALL key points from the previous summary. Do not discard prior context.
- NEVER reproduce any single message verbatim. Always paraphrase and compress.
- Merge new information into appropriate existing topic sections, or add new sections.
- Cover ALL topics — no single topic should exceed 30% of the summary.
- Organize by topic/thread, using brief headers (e.g. "## Topic").
- Preserve: key facts, conclusions, user preferences, data points, names, important timestamps, action items.
- Omit: pleasantries, filler, redundant back-and-forth, detailed tables (summarize their conclusions instead).

{messages}`

const defaultLogger: CompressionLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
}

export async function checkAndCompress(
  aiChatId: string,
  config: CompressionConfig,
  systemPrompt: string,
  llmAdapter: CompressionLlmAdapter,
  convManager: AIChatManager,
  logger: CompressionLogger = defaultLogger
): Promise<CompressionResult> {
  if (!config.enabled) {
    return { compressed: false, reason: 'skipped_disabled' }
  }

  try {
    const contextWindow = llmAdapter.contextWindow || DEFAULT_CONTEXT_WINDOW
    const thresholdTokens = Math.floor(contextWindow * (config.tokenThresholdPercent / 100) * 0.95)

    const summary = convManager.getLatestSummary(aiChatId)

    let messages: Array<{ role: AIMessageRole; content: string; timestamp: number }>
    if (summary) {
      const metaBlock = summary.contentBlocks?.find(
        (b): b is Extract<ContentBlock, { type: 'summary_meta' }> => b.type === 'summary_meta'
      )
      const boundary = metaBlock?.bufferBoundaryTimestamp ?? summary.timestamp
      messages = convManager.getMessagesAfterSummary(aiChatId, boundary - 1)
    } else {
      messages = convManager.getAllUserAssistantMessages(aiChatId)
    }

    const historyForTokenCount: Array<{ role: string; content: string }> = []
    if (summary) {
      historyForTokenCount.push({ role: 'assistant', content: summary.content })
    }
    for (const msg of messages) {
      historyForTokenCount.push({ role: msg.role, content: msg.content })
    }

    const currentTokens = countMessagesTokens(historyForTokenCount, systemPrompt)

    logger.info('Compression', `Token check: ${currentTokens} / ${thresholdTokens} (${contextWindow} window)`, {
      aiChatId,
      messageCount: messages.length,
      hasSummary: !!summary,
    })

    if (currentTokens < thresholdTokens) {
      return { compressed: false, reason: 'skipped_below_threshold', tokensBefore: currentTokens }
    }

    const bufferTokenBudget = Math.floor(contextWindow * (config.bufferSizePercent / 100))
    const { bufferMessages, messagesToCompress } = splitMessagesForCompression(messages, bufferTokenBudget)

    const MIN_MESSAGES_TO_COMPRESS = 3
    if (messagesToCompress.length < MIN_MESSAGES_TO_COMPRESS) {
      return { compressed: false, reason: 'skipped_below_threshold', tokensBefore: currentTokens }
    }

    const isProgressive = !!summary
    const compressInput = buildCompressionInput(messagesToCompress, summary)
    const targetTokens = Math.min(Math.floor(contextWindow * 0.1), 16384)

    const template = isProgressive ? PROGRESSIVE_COMPRESSION_PROMPT : INITIAL_COMPRESSION_PROMPT
    const prompt = template.replace('{maxTokens}', String(targetTokens)).replace('{messages}', compressInput)

    let summaryText = await llmAdapter.compress(prompt, targetTokens)

    if (!summaryText) {
      logger.warn('Compression', 'LLM compression failed, falling back to truncation')
      summaryText = forceTruncate(compressInput, targetTokens)
    }

    const bufferBoundary =
      bufferMessages.length > 0
        ? bufferMessages[0].timestamp
        : messagesToCompress[messagesToCompress.length - 1]!.timestamp + 1

    convManager.addSummaryMessage(aiChatId, summaryText, {
      bufferBoundaryTimestamp: bufferBoundary,
      compressedMessageCount: messagesToCompress.length,
    })

    const afterTokenCount: Array<{ role: string; content: string }> = [
      { role: 'assistant', content: summaryText },
      ...bufferMessages.map((m) => ({ role: m.role, content: m.content })),
    ]
    const tokensAfter = countMessagesTokens(afterTokenCount, systemPrompt)

    if (tokensAfter >= thresholdTokens) {
      logger.warn(
        'Compression',
        `Thrashing detected: ${tokensAfter} tokens after compression still >= ${thresholdTokens}`
      )
      return {
        compressed: true,
        reason: 'thrashing',
        tokensBefore: currentTokens,
        tokensAfter,
        summaryContent: summaryText,
      }
    }

    logger.info('Compression', `Compressed: ${currentTokens} → ${tokensAfter} tokens`)
    return {
      compressed: true,
      reason: 'success',
      tokensBefore: currentTokens,
      tokensAfter,
      summaryContent: summaryText,
    }
  } catch (error) {
    logger.error('Compression', 'Compression failed', { error: String(error) })
    return { compressed: false, reason: 'error', error: String(error) }
  }
}

export async function manualCompress(
  aiChatId: string,
  config: CompressionConfig,
  systemPrompt: string,
  llmAdapter: CompressionLlmAdapter,
  convManager: AIChatManager,
  logger?: CompressionLogger
): Promise<CompressionResult> {
  const messageCount = convManager.getMessageCountAfterSummary(aiChatId)
  if (messageCount < 5) {
    return { compressed: false, reason: 'skipped_idempotent' }
  }

  const overrideConfig = { ...config, enabled: true, tokenThresholdPercent: 0 }
  return checkAndCompress(aiChatId, overrideConfig, systemPrompt, llmAdapter, convManager, logger)
}

// ==================== Internal Helpers ====================

function splitMessagesForCompression(
  messages: Array<{ role: string; content: string; timestamp: number }>,
  bufferTokenBudget: number
): {
  bufferMessages: Array<{ role: string; content: string; timestamp: number }>
  messagesToCompress: Array<{ role: string; content: string; timestamp: number }>
} {
  let bufferTokens = 0
  let splitIndex = messages.length

  for (let i = messages.length - 1; i >= 0; i--) {
    const msgTokens = countTokens(messages[i].content) + 4
    if (bufferTokens + msgTokens > bufferTokenBudget) {
      splitIndex = i + 1
      break
    }
    bufferTokens += msgTokens
    if (i === 0) {
      splitIndex = 0
    }
  }

  return {
    bufferMessages: messages.slice(splitIndex),
    messagesToCompress: messages.slice(0, splitIndex),
  }
}

function buildCompressionInput(
  messagesToCompress: Array<{ role: string; content: string }>,
  existingSummary: { content: string } | null
): string {
  const parts: string[] = []

  if (existingSummary) {
    parts.push(`[PREVIOUS SUMMARY — MUST PRESERVE]\n${existingSummary.content}\n`)
    parts.push(`[NEW MESSAGES — SUMMARIZE AND MERGE]`)
  }

  for (const msg of messagesToCompress) {
    const roleLabel = msg.role === 'user' ? 'User' : 'Assistant'
    parts.push(`${roleLabel}: ${msg.content}`)
  }

  return parts.join('\n\n')
}

function forceTruncate(input: string, targetTokens: number): string {
  const lines = input.split('\n')
  const result: string[] = []
  let tokens = 0
  for (const line of lines) {
    const lineTokens = countTokens(line)
    if (tokens + lineTokens > targetTokens) break
    result.push(line)
    tokens += lineTokens
  }
  return result.join('\n') || input.slice(0, targetTokens * 3)
}
