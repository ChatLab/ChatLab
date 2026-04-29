/**
 * 上下文压缩服务
 * 在 Agent 推理前同步执行，将过长的对话历史压缩为摘要。
 *
 * 核心流程：
 *   1. 计算当前上下文总 token → 未超阈值则跳过
 *   2. 确定缓冲区：最近 bufferSizePercent% context window 的消息原文
 *   3. 缓冲区之前的消息（含旧 summary）→ LLM 压缩为新摘要
 *   4. 写入 ai_message(role='summary')，替换旧 summary
 *   5. Thrashing 检查
 */

import { countTokens, countMessagesTokens } from '../tokenizer'
import {
  getLatestSummary,
  getMessagesAfterSummary,
  getAllUserAssistantMessages,
  addSummaryMessage,
  getMessageCountAfterSummary,
} from '../conversations'
import { buildPiModel, getActiveConfig, findModelDefinition } from '../llm'
import type { AIServiceConfig } from '../llm/types'
import { completeSimple, type TextContent as PiTextContent } from '@mariozechner/pi-ai'
import { aiLogger } from '../logger'

// ==================== 类型定义 ====================

export interface CompressionConfig {
  enabled: boolean
  /** 触发压缩的 token 阈值百分比（相对于 context window），默认 75 */
  tokenThresholdPercent: number
  /** 保留最近消息的缓冲区大小（相对于 context window 的百分比），默认 20 */
  bufferSizePercent: number
  /** 独立压缩模型配置（为空则使用当前对话模型） */
  compressionModelConfigId?: string
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
  error?: string
}

const DEFAULT_COMPRESSION_PROMPT = `Please compress the following conversation history into a concise summary, preserving key information, decisions, and context.
Requirements:
- Preserve key facts, data, names, and conclusions
- Preserve user preferences and important instructions
- Preserve time points and important events
- Output in the same language as the conversation
- Keep it within {maxTokens} tokens

Conversation history:
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
    const messages = summary
      ? getMessagesAfterSummary(conversationId, summary.timestamp)
      : getAllUserAssistantMessages(conversationId)

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
    const { bufferMessages, messagesToCompress } = splitMessagesForCompression(messages, summary, bufferTokenBudget)

    if (messagesToCompress.length === 0) {
      return { compressed: false, reason: 'skipped_below_threshold', tokensBefore: currentTokens }
    }

    // 构建压缩输入文本
    const compressInput = buildCompressionInput(messagesToCompress, summary)
    const targetTokens = Math.floor(contextWindow * 0.1)

    // 三级降级：独立模型 → 当前模型 → 强制截断
    let summaryText: string | null = null

    // 尝试用配置的压缩模型
    if (config.compressionModelConfigId) {
      summaryText = await tryCompress(config.compressionModelConfigId, compressInput, targetTokens)
    }

    // 降级到当前模型
    if (!summaryText) {
      summaryText = await tryCompressWithConfig(activeAIConfig, compressInput, targetTokens)
    }

    // 最终降级：强制截断
    if (!summaryText) {
      aiLogger.warn('Compression', 'LLM compression failed, falling back to truncation')
      summaryText = forceTruncate(compressInput, targetTokens)
    }

    // 写入 summary
    addSummaryMessage(conversationId, summaryText)

    // Thrashing 检查：压缩后重新计算 token
    const afterMessages = getMessagesAfterSummary(conversationId, Date.now() / 1000 - 1)
    const afterTokenCount: Array<{ role: string; content: string }> = [
      { role: 'assistant', content: summaryText },
      ...afterMessages.map((m) => ({ role: m.role, content: m.content })),
    ]
    const tokensAfter = countMessagesTokens(afterTokenCount, systemPrompt)

    if (tokensAfter >= thresholdTokens) {
      aiLogger.warn(
        'Compression',
        `Thrashing detected: ${tokensAfter} tokens after compression still >= ${thresholdTokens}`
      )
      return { compressed: true, reason: 'thrashing', tokensBefore: currentTokens, tokensAfter }
    }

    aiLogger.info('Compression', `Compressed: ${currentTokens} → ${tokensAfter} tokens`)
    return { compressed: true, reason: 'success', tokensBefore: currentTokens, tokensAfter }
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
  summary: { content: string } | null,
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
    parts.push(`[Previous Summary]\n${existingSummary.content}\n`)
  }

  for (const msg of messagesToCompress) {
    const roleLabel = msg.role === 'user' ? 'User' : 'Assistant'
    parts.push(`${roleLabel}: ${msg.content}`)
  }

  return parts.join('\n\n')
}

async function tryCompress(configId: string, input: string, targetTokens: number): Promise<string | null> {
  try {
    const { getAllConfigs } = await import('../llm')
    const allConfigs = getAllConfigs()
    const config = allConfigs.find((c) => c.id === configId)
    if (!config) return null

    return await tryCompressWithConfig(config, input, targetTokens)
  } catch (error) {
    aiLogger.warn('Compression', `Compression with config ${configId} failed`, { error: String(error) })
    return null
  }
}

async function tryCompressWithConfig(
  aiConfig: AIServiceConfig,
  input: string,
  targetTokens: number
): Promise<string | null> {
  try {
    const piModel = buildPiModel(aiConfig)
    const prompt = DEFAULT_COMPRESSION_PROMPT.replace('{maxTokens}', String(targetTokens)).replace('{messages}', input)

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
