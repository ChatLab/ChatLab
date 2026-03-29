/**
 * 会话摘要生成服务
 *
 * 利用 LLM 为会话生成摘要
 * - 智能预处理：过滤无意义内容（纯表情、单字回复等）
 * - 根据消息数量智能调整摘要长度
 * - 超长会话采用 Map-Reduce 策略
 */

import Database from 'better-sqlite3'
import { completeSimple, type TextContent as PiTextContent } from '@mariozechner/pi-ai'
import { getActiveConfig, buildPiModel } from '../llm'
import { getDbPath, openDatabase } from '../../database/core'
import { aiLogger } from '../logger'
import { t } from '../../i18n'

/** 调用 LLM 生成文本（直接使用 pi-ai completeSimple） */
async function llmComplete(
  systemPrompt: string,
  userPrompt: string,
  options?: { temperature?: number; maxTokens?: number }
): Promise<string> {
  const activeConfig = getActiveConfig()
  if (!activeConfig) {
    throw new Error(t('llm.notConfigured'))
  }

  const piModel = buildPiModel(activeConfig)
  const now = Date.now()

  const result = await completeSimple(
    piModel,
    {
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt, timestamp: now }],
    },
    {
      apiKey: activeConfig.apiKey,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
    }
  )

  if (result.stopReason === 'error' || result.stopReason === 'aborted') {
    throw new Error(result.errorMessage || t('llm.callFailed'))
  }

  return result.content
    .filter((item): item is PiTextContent => item.type === 'text')
    .map((item) => item.text)
    .join('')
}

/** 最小消息数阈值（少于此数量不生成摘要） */
const MIN_MESSAGE_COUNT = 3

/** 单次 LLM 调用的最大内容字符数（约 2000 tokens，留安全余量） */
const MAX_CONTENT_PER_CALL = 8000

/** 需要分段处理的阈值 */
const SEGMENT_THRESHOLD = 8000

// ==================== 数据库操作函数（独立于 Worker） ====================

interface SessionMessagesResult {
  messageCount: number
  messages: Array<{
    senderName: string
    content: string | null
  }>
}

/**
 * 获取会话消息（主进程版本，使用 database/core）
 */
function getSessionMessagesForSummary(
  dbSessionId: string,
  chatSessionId: number,
  limit: number = 500
): SessionMessagesResult | null {
  const db = openDatabase(dbSessionId, true)
  if (!db) {
    aiLogger.error('Summary', `Failed to open database: ${dbSessionId}`)
    return null
  }

  try {
    // 获取会话消息
    const messagesSql = `
      SELECT
        COALESCE(mb.group_nickname, mb.account_name, mb.platform_id) as senderName,
        m.content
      FROM message_context mc
      JOIN message m ON m.id = mc.message_id
      JOIN member mb ON mb.id = m.sender_id
      WHERE mc.session_id = ?
      ORDER BY m.ts ASC
      LIMIT ?
    `
    const messages = db.prepare(messagesSql).all(chatSessionId, limit) as Array<{
      senderName: string
      content: string | null
    }>

    return {
      messageCount: messages.length,
      messages,
    }
  } catch (error) {
    aiLogger.error('Summary', `Failed to get session messages: ${error}`)
    return null
  }
}

/**
 * 保存会话摘要（主进程版本）
 */
function saveSessionSummaryToDb(dbSessionId: string, chatSessionId: number, summary: string): void {
  const dbPath = getDbPath(dbSessionId)
  const db = new Database(dbPath)

  try {
    db.prepare('UPDATE chat_session SET summary = ? WHERE id = ?').run(summary, chatSessionId)
  } finally {
    db.close()
  }
}

/**
 * 获取会话摘要（主进程版本）
 */
function getSessionSummaryFromDb(dbSessionId: string, chatSessionId: number): string | null {
  const db = openDatabase(dbSessionId, true)
  if (!db) {
    return null
  }

  try {
    const result = db.prepare('SELECT summary FROM chat_session WHERE id = ?').get(chatSessionId) as
      | { summary: string | null }
      | undefined
    return result?.summary || null
  } catch {
    return null
  }
}

/**
 * 根据消息数量计算摘要长度限制
 * - 3-10 条消息：50 字
 * - 11-30 条消息：80 字
 * - 31-100 条消息：120 字
 * - 100+ 条消息：200 字
 */
function getSummaryLengthLimit(messageCount: number): number {
  if (messageCount <= 10) return 50
  if (messageCount <= 30) return 80
  if (messageCount <= 100) return 120
  return 200
}

/**
 * 判断消息是否有意义（用于过滤）
 * 支持中英文内容过滤
 */
function isValidMessage(content: string): boolean {
  const trimmed = content.trim()

  // 过滤空内容
  if (!trimmed) return false

  // 过滤单字/双字无意义回复（中文）
  if (trimmed.length <= 2) {
    const meaningfulShortZh = ['好的', '不是', '是的', '可以', '不行', '好吧', '明白', '知道', '同意']
    if (!meaningfulShortZh.includes(trimmed)) return false
  }

  // 过滤短无意义回复（英文，不区分大小写）
  const lowerTrimmed = trimmed.toLowerCase()
  const meaninglessShortEn = [
    'ok',
    'k',
    'yes',
    'no',
    'ya',
    'yep',
    'nope',
    'lol',
    'haha',
    'hehe',
    'hmm',
    'ah',
    'oh',
    'wow',
    'thx',
    'ty',
    'np',
    'gg',
    'brb',
    'idk',
  ]
  if (meaninglessShortEn.includes(lowerTrimmed)) return false

  // 过滤纯表情消息
  const emojiOnlyPattern = /^[\p{Emoji}\s[\]（）()]+$/u
  if (emojiOnlyPattern.test(trimmed)) return false

  // 过滤占位符文本（中文 + 英文）
  const placeholders = [
    // 中文占位符（QQ/微信导出格式）
    '[图片]',
    '[语音]',
    '[视频]',
    '[文件]',
    '[表情]',
    '[动画表情]',
    '[位置]',
    '[名片]',
    '[红包]',
    '[转账]',
    '[撤回消息]',
    // 英文占位符
    '[image]',
    '[voice]',
    '[video]',
    '[file]',
    '[sticker]',
    '[animated sticker]',
    '[location]',
    '[contact]',
    '[red packet]',
    '[transfer]',
    '[recalled message]',
    '[photo]',
    '[audio]',
    '[gif]',
  ]
  if (placeholders.some((p) => lowerTrimmed === p.toLowerCase())) return false

  // 过滤系统消息（中文：入群、退群等）
  const systemPatternsZh = [/^.*邀请.*加入了群聊$/, /^.*退出了群聊$/, /^.*撤回了一条消息$/, /^你撤回了一条消息$/]
  if (systemPatternsZh.some((p) => p.test(trimmed))) return false

  // 过滤系统消息（英文）
  const systemPatternsEn = [
    /^.*invited.*to the group$/i,
    /^.*left the group$/i,
    /^.*recalled a message$/i,
    /^you recalled a message$/i,
    /^.*joined the group$/i,
    /^.*has been removed$/i,
  ]
  if (systemPatternsEn.some((p) => p.test(trimmed))) return false

  return true
}

/**
 * 预处理消息：过滤无意义内容
 */
function preprocessMessages(
  messages: Array<{ senderName: string; content: string | null }>
): Array<{ senderName: string; content: string }> {
  return messages
    .filter((m) => m.content && isValidMessage(m.content))
    .map((m) => ({ senderName: m.senderName, content: m.content!.trim() }))
}

/**
 * 格式化消息为文本
 */
function formatMessages(messages: Array<{ senderName: string; content: string }>): string {
  return messages.map((m) => `${m.senderName}: ${m.content}`).join('\n')
}

/**
 * 将消息分成多个段落
 */
function splitIntoSegments(
  messages: Array<{ senderName: string; content: string }>,
  maxCharsPerSegment: number
): Array<Array<{ senderName: string; content: string }>> {
  const segments: Array<Array<{ senderName: string; content: string }>> = []
  let currentSegment: Array<{ senderName: string; content: string }> = []
  let currentLength = 0

  for (const msg of messages) {
    const msgLength = msg.senderName.length + msg.content.length + 3 // "name: content\n"

    if (currentLength + msgLength > maxCharsPerSegment && currentSegment.length > 0) {
      segments.push(currentSegment)
      currentSegment = []
      currentLength = 0
    }

    currentSegment.push(msg)
    currentLength += msgLength
  }

  if (currentSegment.length > 0) {
    segments.push(currentSegment)
  }

  return segments
}

/**
 * 生成摘要的 Prompt
 */
function buildSummaryPrompt(content: string, lengthLimit: number, locale: string): string {
  if (locale.startsWith('zh')) {
    return `请用简洁的语言（${lengthLimit}字以内）总结以下对话的主要内容或话题。只输出摘要内容，不要添加任何前缀、解释或引号。

${content}`
  }
  return `Summarize the following conversation concisely (max ${lengthLimit} characters). Output only the summary, no prefix, explanation, or quotes.

${content}`
}

/**
 * 生成子摘要的 Prompt
 */
function buildSubSummaryPrompt(content: string, locale: string): string {
  if (locale.startsWith('zh')) {
    return `请用一句话（不超过50字）概括以下对话片段的主要内容。只输出摘要内容，不要添加任何前缀、解释或引号。

${content}`
  }
  return `Summarize this conversation segment in one sentence (max 50 characters). Output only the summary, no prefix or quotes.

${content}`
}

/**
 * 合并子摘要的 Prompt
 */
function buildMergePrompt(subSummaries: string[], lengthLimit: number, locale: string): string {
  const summaryList = subSummaries.map((s, i) => `${i + 1}. ${s}`).join('\n')
  if (locale.startsWith('zh')) {
    return `以下是一段对话的多个片段摘要，请将它们合并成一个完整的总结（${lengthLimit}字以内）。只输出摘要内容，不要添加任何前缀、解释或引号。

${summaryList}`
  }
  return `Below are summaries of different parts of a conversation. Merge them into one cohesive summary (max ${lengthLimit} characters). Output only the summary, no prefix or quotes.

${summaryList}`
}

/**
 * 生成会话摘要
 *
 * @param dbSessionId 数据库会话ID（用于访问数据库）
 * @param chatSessionId 会话索引中的会话ID
 * @param locale 语言设置
 * @param forceRegenerate 是否强制重新生成（忽略缓存）
 * @returns 摘要内容或错误
 */
export async function generateSessionSummary(
  dbSessionId: string,
  chatSessionId: number,
  locale: string = 'zh-CN',
  forceRegenerate: boolean = false
): Promise<{ success: boolean; summary?: string; error?: string }> {
  try {
    // 1. 检查是否已有摘要（除非强制重新生成）
    if (!forceRegenerate) {
      const existing = getSessionSummaryFromDb(dbSessionId, chatSessionId)
      if (existing) {
        return { success: true, summary: existing }
      }
    }

    // 2. 获取会话消息
    const sessionData = getSessionMessagesForSummary(dbSessionId, chatSessionId)
    if (!sessionData) {
      return { success: false, error: t('summary.sessionNotFound') }
    }

    // 3. 检查消息数量
    if (sessionData.messageCount < MIN_MESSAGE_COUNT) {
      return {
        success: false,
        error: t('summary.tooFewMessages', { count: MIN_MESSAGE_COUNT }),
      }
    }

    // 4. 预处理：过滤无意义消息
    const validMessages = preprocessMessages(sessionData.messages)
    if (validMessages.length < MIN_MESSAGE_COUNT) {
      return {
        success: false,
        error: t('summary.tooFewValidMessages', { count: MIN_MESSAGE_COUNT }),
      }
    }

    // 5. 计算摘要长度限制
    const lengthLimit = getSummaryLengthLimit(validMessages.length)

    // 6. 格式化内容
    const content = formatMessages(validMessages)

    aiLogger.info(
      'Summary',
      `生成会话摘要: sessionId=${chatSessionId}, 原始消息=${sessionData.messageCount}, 有效消息=${validMessages.length}, 内容长度=${content.length}`
    )

    let summary: string

    // 7. 根据内容长度决定处理策略
    if (content.length <= SEGMENT_THRESHOLD) {
      // 短会话：直接生成摘要
      summary = await generateDirectSummary(content, lengthLimit, locale)
    } else {
      // 长会话：Map-Reduce 策略
      summary = await generateMapReduceSummary(validMessages, lengthLimit, locale)
    }

    // 8. 后处理：移除引号
    if ((summary.startsWith('"') && summary.endsWith('"')) || (summary.startsWith('「') && summary.endsWith('」'))) {
      summary = summary.slice(1, -1)
    }

    // 如果摘要超过限制的 1.5 倍，进行截断
    const hardLimit = Math.floor(lengthLimit * 1.5)
    if (summary.length > hardLimit) {
      summary = summary.slice(0, hardLimit - 3) + '...'
    }

    // 9. 保存到数据库
    saveSessionSummaryToDb(dbSessionId, chatSessionId, summary)

    aiLogger.info('Summary', `Summary generated: "${summary.slice(0, 50)}..."`)

    return { success: true, summary }
  } catch (error) {
    aiLogger.error('Summary', 'Summary generation failed', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * 直接生成摘要（适用于短会话）
 */
async function generateDirectSummary(content: string, lengthLimit: number, locale: string): Promise<string> {
  const result = await llmComplete(t('summary.systemPromptDirect'), buildSummaryPrompt(content, lengthLimit, locale), {
    temperature: 0.3,
    maxTokens: 300,
  })
  return result.trim()
}

/**
 * Map-Reduce 策略生成摘要（适用于长会话）
 */
async function generateMapReduceSummary(
  messages: Array<{ senderName: string; content: string }>,
  lengthLimit: number,
  locale: string
): Promise<string> {
  // 1. Map：分段生成子摘要
  const segments = splitIntoSegments(messages, MAX_CONTENT_PER_CALL)
  aiLogger.info('Summary', `Long session segmented: ${segments.length}  segments`)

  const subSummaries: string[] = []

  for (let i = 0; i < segments.length; i++) {
    const segmentContent = formatMessages(segments[i])
    const result = await llmComplete(t('summary.systemPromptDirect'), buildSubSummaryPrompt(segmentContent, locale), {
      temperature: 0.3,
      maxTokens: 100,
    })
    subSummaries.push(result.trim())
  }

  // 2. Reduce：合并子摘要
  if (subSummaries.length === 1) {
    return subSummaries[0]
  }

  const mergeResult = await llmComplete(
    t('summary.systemPromptMerge'),
    buildMergePrompt(subSummaries, lengthLimit, locale),
    { temperature: 0.3, maxTokens: 300 }
  )

  return mergeResult.trim()
}

/**
 * 批量生成会话摘要
 *
 * @param dbSessionId 数据库会话ID
 * @param chatSessionIds 会话ID列表
 * @param locale 语言设置
 * @param onProgress 进度回调
 * @returns 生成结果
 */
export async function generateSessionSummaries(
  dbSessionId: string,
  chatSessionIds: number[],
  locale: string = 'zh-CN',
  onProgress?: (current: number, total: number) => void
): Promise<{ success: number; failed: number; skipped: number }> {
  let success = 0
  let failed = 0
  let skipped = 0

  for (let i = 0; i < chatSessionIds.length; i++) {
    const chatSessionId = chatSessionIds[i]

    const result = await generateSessionSummary(dbSessionId, chatSessionId, locale, false)

    if (result.success) {
      success++
    } else if (result.error?.includes('少于') || result.error?.includes('less than') || result.error?.includes('few')) {
      skipped++
    } else {
      failed++
    }

    if (onProgress) {
      onProgress(i + 1, chatSessionIds.length)
    }
  }

  return { success, failed, skipped }
}

/**
 * 批量检查会话是否可以生成摘要
 *
 * @param dbSessionId 数据库会话ID
 * @param chatSessionIds 会话ID列表
 * @returns 每个会话的检查结果
 */
export function checkSessionsCanGenerateSummary(
  dbSessionId: string,
  chatSessionIds: number[]
): Map<number, { canGenerate: boolean; reason?: string }> {
  const results = new Map<number, { canGenerate: boolean; reason?: string }>()

  for (const chatSessionId of chatSessionIds) {
    // 获取会话消息
    const sessionData = getSessionMessagesForSummary(dbSessionId, chatSessionId)

    if (!sessionData) {
      results.set(chatSessionId, { canGenerate: false, reason: t('summary.sessionNotExist') })
      continue
    }

    // 检查原始消息数量
    if (sessionData.messageCount < MIN_MESSAGE_COUNT) {
      results.set(chatSessionId, { canGenerate: false, reason: t('summary.messagesTooFew') })
      continue
    }

    // 预处理：过滤无意义消息
    const validMessages = preprocessMessages(sessionData.messages)
    if (validMessages.length < MIN_MESSAGE_COUNT) {
      results.set(chatSessionId, { canGenerate: false, reason: t('summary.validMessagesTooFew') })
      continue
    }

    results.set(chatSessionId, { canGenerate: true })
  }

  return results
}
