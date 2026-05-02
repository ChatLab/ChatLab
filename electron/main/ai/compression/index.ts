/**
 * 上下文压缩服务
 * 在 Agent 推理前同步执行，将过长的对话历史压缩为摘要。
 *
 * 核心流程：
 *   1. 计算当前上下文总 token → 未超阈值则跳过
 *   2. 确定缓冲区：最近 bufferSizePercent% context window 的消息原文
 *   3. 缓冲区之前的消息（含旧 system 摘要）→ LLM 压缩为新摘要
 *   4. 写入 ai_message(role='summary')，替换旧摘要
 *   5. Thrashing 检查
 */

import { countTokens, countMessagesTokens } from '../tokenizer'
import {
  getLatestSummary,
  getMessagesAfterSummary,
  getAllUserAssistantMessages,
  addSummaryMessage,
  getMessageCountAfterSummary,
  setDebugContext,
  type ContentBlock,
  type AIMessageRole,
} from '../conversations'
import { buildPiModel, findModelDefinition } from '../llm'
import type { AIServiceConfig } from '../llm/types'
import { completeSimple, type TextContent as PiTextContent } from '@mariozechner/pi-ai'
import { aiLogger, isDebugMode } from '../logger'

// ==================== 类型定义 ====================

export interface CompressionConfig {
  enabled: boolean
  /** 触发压缩的 token 阈值百分比（相对于 context window），默认 75 */
  tokenThresholdPercent: number
  /** 保留最近消息的缓冲区大小（相对于 context window 的百分比），默认 20 */
  bufferSizePercent: number
  /** 单次工具返回的最大上下文占比（相对于 context window 的百分比），默认 35 */
  maxToolResultPercent?: number
}

export interface CompressionResult {
  compressed: boolean
  reason:
    | 'skipped_disabled'
    | 'skipped_below_threshold'
    | 'skipped_idempotent'
    | 'success'
    | 'fallback_truncated'
    | 'thrashing'
    | 'error'
  tokensBefore?: number
  tokensAfter?: number
  summaryContent?: string
  error?: string
}

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

const DEFAULT_CONTEXT_WINDOW = 128000

// ==================== 核心压缩逻辑 ====================

/**
 * 检查并执行上下文压缩（同步，在 Agent 推理前调用）
 */
export async function checkAndCompress(
  conversationId: string,
  config: CompressionConfig,
  systemPrompt: string,
  activeAIConfig: AIServiceConfig
): Promise<CompressionResult> {
  if (!config.enabled) {
    return { compressed: false, reason: 'skipped_disabled' }
  }

  try {
    const contextWindow = resolveContextWindow(config, activeAIConfig)
    const thresholdTokens = Math.floor(contextWindow * (config.tokenThresholdPercent / 100) * 0.95)

    // 收集当前上下文消息
    const summary = getLatestSummary(conversationId)

    let messages: Array<{ role: AIMessageRole; content: string; timestamp: number }>
    if (summary) {
      // 从 summary_meta 获取 buffer 边界，取 >= boundary 的消息（buffer + 新消息）
      const metaBlock = summary.contentBlocks?.find(
        (b): b is Extract<ContentBlock, { type: 'summary_meta' }> => b.type === 'summary_meta'
      )
      const boundary = metaBlock?.bufferBoundaryTimestamp ?? summary.timestamp
      messages = getMessagesAfterSummary(conversationId, boundary - 1)
    } else {
      messages = getAllUserAssistantMessages(conversationId)
    }

    // 构建 token 计算的消息列表
    const historyForTokenCount: Array<{ role: string; content: string }> = []
    if (summary) {
      historyForTokenCount.push({ role: 'assistant', content: summary.content })
    }
    for (const msg of messages) {
      historyForTokenCount.push({ role: msg.role, content: msg.content })
    }

    const currentTokens = countMessagesTokens(historyForTokenCount, systemPrompt)

    aiLogger.info('Compression', `Token check: ${currentTokens} / ${thresholdTokens} (${contextWindow} window)`, {
      conversationId,
      messageCount: messages.length,
      hasSummary: !!summary,
    })

    if (currentTokens < thresholdTokens) {
      return { compressed: false, reason: 'skipped_below_threshold', tokensBefore: currentTokens }
    }

    // 确定缓冲区（保留最近 N% 的消息）
    const bufferTokenBudget = Math.floor(contextWindow * (config.bufferSizePercent / 100))
    const { bufferMessages, messagesToCompress } = splitMessagesForCompression(messages, bufferTokenBudget)

    aiLogger.info('Compression', `Split result`, {
      totalMessages: messages.length,
      messagesToCompress: messagesToCompress.length,
      bufferMessages: bufferMessages.length,
      bufferTokenBudget,
      hasPreviousSummary: !!summary,
    })

    // 待压缩消息数过少时跳过，避免生成低质量摘要（仅保留 1-2 条消息时 LLM 倾向于原文照搬）
    const MIN_MESSAGES_TO_COMPRESS = 3
    if (messagesToCompress.length < MIN_MESSAGES_TO_COMPRESS) {
      aiLogger.info(
        'Compression',
        `Skipping: only ${messagesToCompress.length} messages to compress (min: ${MIN_MESSAGES_TO_COMPRESS})`
      )
      return { compressed: false, reason: 'skipped_below_threshold', tokensBefore: currentTokens }
    }

    // 构建压缩输入文本
    const isProgressive = !!summary
    const compressInput = buildCompressionInput(messagesToCompress, summary)
    const targetTokens = Math.min(Math.floor(contextWindow * 0.1), 16384)

    aiLogger.info('Compression', `Compression params`, {
      mode: isProgressive ? 'progressive' : 'initial',
      targetTokens,
      inputLength: compressInput.length,
      inputTokensEstimate: countTokens(compressInput),
    })

    // 使用默认助手模型压缩，失败则强制截断
    let summaryText: string | null = null

    summaryText = await tryCompressWithConfig(activeAIConfig, compressInput, targetTokens, isProgressive)

    if (!summaryText) {
      aiLogger.warn('Compression', 'LLM compression failed, falling back to truncation')
      summaryText = forceTruncate(compressInput, targetTokens)
      aiLogger.info('Compression', 'Truncation fallback applied', {
        outputLength: summaryText.length,
      })
    } else {
      aiLogger.info('Compression', 'LLM compression succeeded', {
        outputLength: summaryText.length,
        outputTokensEstimate: countTokens(summaryText),
      })
    }

    // 写入 summary：时间戳 = NOW（UI 中显示在触发压缩的位置）
    // buffer 边界 + 压缩消息数存入 content_blocks 的 summary_meta block
    const bufferBoundary =
      bufferMessages.length > 0
        ? bufferMessages[0].timestamp
        : messagesToCompress[messagesToCompress.length - 1]!.timestamp + 1

    const summaryMeta = {
      bufferBoundaryTimestamp: bufferBoundary,
      compressedMessageCount: messagesToCompress.length,
    }

    aiLogger.info('Compression', 'Writing summary', {
      bufferBoundary,
      compressedCount: messagesToCompress.length,
      bufferCount: bufferMessages.length,
    })

    const summaryMsg = addSummaryMessage(conversationId, summaryText, summaryMeta)

    // DEBUG 模式：记录发给压缩 LLM 的完整上下文（与 assistant 的 debug_context 格式一致）
    if (isDebugMode()) {
      try {
        const template = isProgressive ? PROGRESSIVE_COMPRESSION_PROMPT : INITIAL_COMPRESSION_PROMPT
        const fullPrompt = template.replace('{maxTokens}', String(targetTokens)).replace('{messages}', compressInput)
        const debugMessages = [{ role: 'user', content: fullPrompt }]
        setDebugContext(summaryMsg.id, JSON.stringify(debugMessages, null, 2))
      } catch {
        // 静默失败，不影响主流程
      }
    }

    // Thrashing 检查：压缩后重新计算 token（summary + buffer 消息）
    const afterTokenCount: Array<{ role: string; content: string }> = [
      { role: 'assistant', content: summaryText },
      ...bufferMessages.map((m) => ({ role: m.role, content: m.content })),
    ]
    const tokensAfter = countMessagesTokens(afterTokenCount, systemPrompt)

    if (tokensAfter >= thresholdTokens) {
      aiLogger.warn(
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

    aiLogger.info('Compression', `Compressed: ${currentTokens} → ${tokensAfter} tokens`)
    return {
      compressed: true,
      reason: 'success',
      tokensBefore: currentTokens,
      tokensAfter,
      summaryContent: summaryText,
    }
  } catch (error) {
    aiLogger.error('Compression', 'Compression failed', { error: String(error) })
    return { compressed: false, reason: 'error', error: String(error) }
  }
}

/**
 * 手动压缩（用户手动触发，含幂等检查）
 */
export async function manualCompress(
  conversationId: string,
  config: CompressionConfig,
  systemPrompt: string,
  activeAIConfig: AIServiceConfig
): Promise<CompressionResult> {
  const messageCount = getMessageCountAfterSummary(conversationId)
  if (messageCount < 5) {
    return { compressed: false, reason: 'skipped_idempotent' }
  }

  // 手动压缩忽略阈值，强制执行
  const overrideConfig = { ...config, enabled: true, tokenThresholdPercent: 0 }
  return checkAndCompress(conversationId, overrideConfig, systemPrompt, activeAIConfig)
}

// ==================== 内部辅助函数 ====================

function resolveContextWindow(_config: CompressionConfig, activeAIConfig: AIServiceConfig): number {
  const modelDef = findModelDefinition(activeAIConfig.provider, activeAIConfig.model || '')
  return modelDef?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
}

interface SplitResult {
  bufferMessages: Array<{ role: string; content: string; timestamp: number }>
  messagesToCompress: Array<{ role: string; content: string; timestamp: number }>
}

function splitMessagesForCompression(
  messages: Array<{ role: string; content: string; timestamp: number }>,
  bufferTokenBudget: number
): SplitResult {
  let bufferTokens = 0
  let splitIndex = messages.length

  // 从最近的消息向前累计，直到达到缓冲区预算
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

async function tryCompressWithConfig(
  aiConfig: AIServiceConfig,
  input: string,
  targetTokens: number,
  isProgressive: boolean
): Promise<string | null> {
  try {
    const piModel = buildPiModel(aiConfig)
    const template = isProgressive ? PROGRESSIVE_COMPRESSION_PROMPT : INITIAL_COMPRESSION_PROMPT
    const prompt = template.replace('{maxTokens}', String(targetTokens)).replace('{messages}', input)

    const result = await completeSimple(
      piModel,
      {
        systemPrompt: undefined,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: prompt }],
            timestamp: Date.now(),
          },
        ] as any,
      },
      {
        apiKey: aiConfig.apiKey,
        maxTokens: targetTokens,
      }
    )

    const text = result.content
      .filter((item): item is PiTextContent => item.type === 'text')
      .map((item) => item.text)
      .join('')

    return text || null
  } catch (error) {
    aiLogger.warn('Compression', 'LLM compression attempt failed', { error: String(error) })
    return null
  }
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
