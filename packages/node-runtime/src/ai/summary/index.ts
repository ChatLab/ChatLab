/**
 * Session summary generation — shared implementation.
 *
 * Uses Map-Reduce strategy for long conversations.
 * All platform-specific concerns (DB access, LLM invocation, i18n) are injected
 * via the SummaryDeps interface.
 */

// ==================== Types ====================

export interface SummaryMessage {
  senderName: string
  content: string | null
}

export interface SummaryDeps {
  loadMessages: (segmentId: number, limit?: number) => SummaryMessage[] | null
  saveSummary: (segmentId: number, summary: string) => void
  getSummary: (segmentId: number) => string | null
  llmComplete: (
    systemPrompt: string,
    userPrompt: string,
    options?: { temperature?: number; maxTokens?: number }
  ) => Promise<string>
  t: (key: string, options?: Record<string, unknown>) => string
  logger?: {
    info: (category: string, message: string, data?: unknown) => void
    error: (category: string, message: string, data?: unknown) => void
  }
}

export type SummaryStrategy = 'brief' | 'standard'

export interface SummaryOptions {
  locale?: string
  forceRegenerate?: boolean
  strategy?: SummaryStrategy
}

export interface SummaryResult {
  success: boolean
  summary?: string
  error?: string
}

// ==================== Constants ====================

const MIN_MESSAGE_COUNT = 3
const MAX_CONTENT_PER_CALL = 8000
const SEGMENT_THRESHOLD = 8000

// ==================== Pure algorithms ====================

function getSummaryLengthLimit(messageCount: number, strategy: SummaryStrategy = 'standard'): number {
  if (strategy === 'brief') {
    if (messageCount <= 10) return 50
    if (messageCount <= 30) return 80
    if (messageCount <= 100) return 120
    return 200
  }
  // standard: richer summaries covering who, what, and key details
  if (messageCount <= 10) return 100
  if (messageCount <= 30) return 200
  if (messageCount <= 100) return 350
  return 500
}

const MEANINGFUL_SHORT_ZH = ['好的', '不是', '是的', '可以', '不行', '好吧', '明白', '知道', '同意']
const MEANINGLESS_SHORT_EN = [
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
const PLACEHOLDERS = [
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
const SYSTEM_PATTERNS_ZH = [/^.*邀请.*加入了群聊$/, /^.*退出了群聊$/, /^.*撤回了一条消息$/, /^你撤回了一条消息$/]
const SYSTEM_PATTERNS_EN = [
  /^.*invited.*to the group$/i,
  /^.*left the group$/i,
  /^.*recalled a message$/i,
  /^you recalled a message$/i,
  /^.*joined the group$/i,
  /^.*has been removed$/i,
]

export function isValidMessage(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed) return false

  if (trimmed.length <= 2 && !MEANINGFUL_SHORT_ZH.includes(trimmed)) return false

  const lower = trimmed.toLowerCase()
  if (MEANINGLESS_SHORT_EN.includes(lower)) return false

  if (/^[\p{Emoji}\s[\]（）()]+$/u.test(trimmed)) return false
  if (PLACEHOLDERS.some((p) => lower === p.toLowerCase())) return false
  if (SYSTEM_PATTERNS_ZH.some((p) => p.test(trimmed))) return false
  if (SYSTEM_PATTERNS_EN.some((p) => p.test(trimmed))) return false

  return true
}

export function filterValidMessages(messages: SummaryMessage[]): Array<{ senderName: string; content: string }> {
  return messages
    .filter((m) => m.content && isValidMessage(m.content))
    .map((m) => ({ senderName: m.senderName, content: m.content!.trim() }))
}

function formatMessages(messages: Array<{ senderName: string; content: string }>): string {
  return messages.map((m) => `${m.senderName}: ${m.content}`).join('\n')
}

export function splitIntoSegments(
  messages: Array<{ senderName: string; content: string }>,
  maxCharsPerSegment: number
): Array<Array<{ senderName: string; content: string }>> {
  const segments: Array<Array<{ senderName: string; content: string }>> = []
  let currentSegment: Array<{ senderName: string; content: string }> = []
  let currentLength = 0

  for (const msg of messages) {
    const msgLength = msg.senderName.length + msg.content.length + 3
    if (currentLength + msgLength > maxCharsPerSegment && currentSegment.length > 0) {
      segments.push(currentSegment)
      currentSegment = []
      currentLength = 0
    }
    currentSegment.push(msg)
    currentLength += msgLength
  }
  if (currentSegment.length > 0) segments.push(currentSegment)
  return segments
}

// ==================== Prompt builders ====================

function buildSummaryPrompt(content: string, lengthLimit: number, locale: string, strategy: SummaryStrategy): string {
  if (strategy === 'brief') {
    if (locale.startsWith('zh')) {
      return `请用简洁的语言（${lengthLimit}字以内）总结以下对话的主要内容或话题。只输出摘要内容，不要添加任何前缀、解释或引号。\n\n${content}`
    }
    return `Summarize the following conversation concisely (max ${lengthLimit} characters). Output only the summary, no prefix, explanation, or quotes.\n\n${content}`
  }
  if (locale.startsWith('zh')) {
    return `请总结以下聊天记录（${lengthLimit}字以内），需包含：谁参与了讨论、讨论了什么事情、关键细节和结论。用2-4句话描述，不要罗列每条消息。只输出摘要内容，不要添加任何前缀、解释或引号。\n\n${content}`
  }
  return `Summarize the following chat log (max ${lengthLimit} characters). Include: who participated, what was discussed, key details and conclusions. Use 2-4 sentences, don't list individual messages. Output only the summary, no prefix, explanation, or quotes.\n\n${content}`
}

function buildSubSummaryPrompt(content: string, locale: string, strategy: SummaryStrategy): string {
  const limit = strategy === 'brief' ? 50 : 100
  if (locale.startsWith('zh')) {
    return `请用一到两句话（不超过${limit}字）概括以下对话片段的主要内容，包括谁说了什么。只输出摘要内容，不要添加任何前缀、解释或引号。\n\n${content}`
  }
  return `Summarize this conversation segment in 1-2 sentences (max ${limit} characters), including who said what. Output only the summary, no prefix or quotes.\n\n${content}`
}

function buildMergePrompt(
  subSummaries: string[],
  lengthLimit: number,
  locale: string,
  strategy: SummaryStrategy
): string {
  const list = subSummaries.map((s, i) => `${i + 1}. ${s}`).join('\n')
  if (strategy === 'brief') {
    if (locale.startsWith('zh')) {
      return `以下是一段对话的多个片段摘要，请将它们合并成一个完整的总结（${lengthLimit}字以内）。只输出摘要内容，不要添加任何前缀、解释或引号。\n\n${list}`
    }
    return `Below are summaries of different parts of a conversation. Merge them into one cohesive summary (max ${lengthLimit} characters). Output only the summary, no prefix or quotes.\n\n${list}`
  }
  if (locale.startsWith('zh')) {
    return `以下是一段对话的多个片段摘要，请将它们合并成一个完整的总结（${lengthLimit}字以内）。保留参与者、事件和关键细节。只输出摘要内容，不要添加任何前缀、解释或引号。\n\n${list}`
  }
  return `Below are summaries of different parts of a conversation. Merge them into one cohesive summary (max ${lengthLimit} characters). Preserve participants, events, and key details. Output only the summary, no prefix or quotes.\n\n${list}`
}

// ==================== Post-processing ====================

function postProcessSummary(summary: string, lengthLimit: number): string {
  let result = summary
  if ((result.startsWith('"') && result.endsWith('"')) || (result.startsWith('「') && result.endsWith('」'))) {
    result = result.slice(1, -1)
  }
  const hardLimit = Math.floor(lengthLimit * 1.5)
  if (result.length > hardLimit) {
    result = result.slice(0, hardLimit - 3) + '...'
  }
  return result
}

// ==================== Public API ====================

export async function generateSessionSummary(
  deps: SummaryDeps,
  segmentId: number,
  options: SummaryOptions = {}
): Promise<SummaryResult> {
  const { locale = 'zh-CN', forceRegenerate = false, strategy = 'standard' } = options
  const log = deps.logger

  try {
    if (!forceRegenerate) {
      const existing = deps.getSummary(segmentId)
      if (existing) return { success: true, summary: existing }
    }

    const rawMessages = deps.loadMessages(segmentId)
    if (!rawMessages) {
      return { success: false, error: deps.t('summary.sessionNotFound') }
    }

    if (rawMessages.length < MIN_MESSAGE_COUNT) {
      return { success: false, error: deps.t('summary.tooFewMessages', { count: MIN_MESSAGE_COUNT }) }
    }

    const validMessages = filterValidMessages(rawMessages)
    if (validMessages.length < MIN_MESSAGE_COUNT) {
      return { success: false, error: deps.t('summary.tooFewValidMessages', { count: MIN_MESSAGE_COUNT }) }
    }

    const lengthLimit = getSummaryLengthLimit(validMessages.length, strategy)
    const maxTokens = strategy === 'brief' ? 300 : 600
    const subMaxTokens = strategy === 'brief' ? 100 : 200
    const content = formatMessages(validMessages)

    log?.info(
      'Summary',
      `Generating summary: sessionId=${segmentId}, strategy=${strategy}, raw=${rawMessages.length}, valid=${validMessages.length}, chars=${content.length}`
    )

    let summary: string
    if (content.length <= SEGMENT_THRESHOLD) {
      summary = await deps.llmComplete(
        deps.t('summary.systemPromptDirect'),
        buildSummaryPrompt(content, lengthLimit, locale, strategy),
        { temperature: 0.3, maxTokens }
      )
      summary = summary.trim()
    } else {
      const segments = splitIntoSegments(validMessages, MAX_CONTENT_PER_CALL)
      log?.info('Summary', `Long session segmented: ${segments.length} segments`)

      const subSummaries: string[] = []
      for (const segment of segments) {
        const segContent = formatMessages(segment)
        const sub = await deps.llmComplete(
          deps.t('summary.systemPromptDirect'),
          buildSubSummaryPrompt(segContent, locale, strategy),
          { temperature: 0.3, maxTokens: subMaxTokens }
        )
        subSummaries.push(sub.trim())
      }

      if (subSummaries.length === 1) {
        summary = subSummaries[0]
      } else {
        summary = await deps.llmComplete(
          deps.t('summary.systemPromptMerge'),
          buildMergePrompt(subSummaries, lengthLimit, locale, strategy),
          { temperature: 0.3, maxTokens }
        )
        summary = summary.trim()
      }
    }

    summary = postProcessSummary(summary, lengthLimit)
    deps.saveSummary(segmentId, summary)

    log?.info('Summary', `Summary generated: "${summary.slice(0, 50)}..."`)
    return { success: true, summary }
  } catch (error) {
    log?.error('Summary', 'Summary generation failed', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function generateSessionSummaries(
  deps: SummaryDeps,
  segmentIds: number[],
  options: SummaryOptions = {},
  onProgress?: (current: number, total: number) => void
): Promise<{ success: number; failed: number; skipped: number }> {
  let success = 0
  let failed = 0
  let skipped = 0

  for (let i = 0; i < segmentIds.length; i++) {
    const result = await generateSessionSummary(deps, segmentIds[i], options)
    if (result.success) {
      success++
    } else if (result.error?.includes('少于') || result.error?.includes('less than') || result.error?.includes('few')) {
      skipped++
    } else {
      failed++
    }
    onProgress?.(i + 1, segmentIds.length)
  }

  return { success, failed, skipped }
}

export function checkSessionsCanGenerateSummary(
  deps: Pick<SummaryDeps, 'loadMessages' | 't'>,
  segmentIds: number[]
): Map<number, { canGenerate: boolean; reason?: string }> {
  const results = new Map<number, { canGenerate: boolean; reason?: string }>()

  for (const id of segmentIds) {
    const messages = deps.loadMessages(id)
    if (!messages) {
      results.set(id, { canGenerate: false, reason: deps.t('summary.sessionNotExist') })
      continue
    }
    if (messages.length < MIN_MESSAGE_COUNT) {
      results.set(id, { canGenerate: false, reason: deps.t('summary.messagesTooFew') })
      continue
    }
    const valid = filterValidMessages(messages)
    if (valid.length < MIN_MESSAGE_COUNT) {
      results.set(id, { canGenerate: false, reason: deps.t('summary.validMessagesTooFew') })
      continue
    }
    results.set(id, { canGenerate: true })
  }

  return results
}
