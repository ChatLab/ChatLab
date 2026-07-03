/**
 * 工具结果格式化 & i18n 辅助（平台无关）
 */

export function isChineseLocale(locale?: string): boolean {
  return locale?.startsWith('zh') ?? false
}

export const i18nTexts = {
  allTime: { zh: '全部时间', en: 'All time' },
  noContent: { zh: '[无内容]', en: '[No content]' },
  memberNotFound: { zh: '未找到该成员', en: 'Member not found' },
  untilNow: { zh: '至今', en: 'Present' },
  noChangeRecord: { zh: '无变更记录', en: 'No change record' },
  noConversation: { zh: '未找到这两人之间的对话', en: 'No conversation found between these two members' },
  noMessageContext: { zh: '未找到指定的消息或上下文', en: 'Message or context not found' },
  messages: { zh: '条', en: '' },
  alias: { zh: '别名', en: 'Alias' },
  weekdays: {
    zh: ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    en: ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  },
  dailySummary: {
    zh: (days: number, total: number, avg: number) => `最近${days}天共${total}条，日均${avg}条`,
    en: (days: number, total: number, avg: number) => `Last ${days} days: ${total} messages, avg ${avg}/day`,
  },
}

type TextEntryKey = Exclude<keyof typeof i18nTexts, 'dailySummary'>

export function t(key: TextEntryKey, locale?: string): string | string[] {
  const text = i18nTexts[key]
  if (typeof text === 'object' && 'zh' in text && 'en' in text) {
    return isChineseLocale(locale) ? text.zh : text.en
  }
  return ''
}

const MAX_MESSAGE_CONTENT_LENGTH = 200

export interface FormatMessageOptions {
  /** Render an [#id] prefix for message citations (CLI agent format). */
  includeMessageId?: boolean
  /** Message ids that are search hits; rendered as [#id*]. */
  hitIds?: Set<number>
  /** Per-message content char limit; 0 disables truncation. Default 200. */
  maxContentLength?: number
}

/**
 * 格式化消息为简洁文本格式
 * 输出格式: "2025/3/3 07:25:04 张三: 消息内容"
 * includeMessageId 开启时: "[#1021] 2025/3/3 07:25:04 张三: 消息内容"（合并块为 [#start-end]）
 */
export function formatMessageCompact(
  msg: {
    id?: number
    senderName: string
    content: string | null
    timestamp: number
    mergedEndId?: number
  },
  locale?: string,
  options?: FormatMessageOptions
): string {
  const localeStr = isChineseLocale(locale) ? 'zh-CN' : 'en-US'
  const time = new Date(msg.timestamp * 1000).toLocaleString(localeStr)
  let content = msg.content || (t('noContent', locale) as string)

  const maxLength = options?.maxContentLength ?? MAX_MESSAGE_CONTENT_LENGTH
  if (maxLength > 0 && content.length > maxLength) {
    content = content.slice(0, maxLength) + '...'
  }

  let idPrefix = ''
  if (options?.includeMessageId && msg.id != null) {
    const range = msg.mergedEndId != null && msg.mergedEndId !== msg.id ? `${msg.id}-${msg.mergedEndId}` : `${msg.id}`
    const hitMark = options.hitIds?.has(msg.id) ? '*' : ''
    idPrefix = `[#${range}${hitMark}] `
  }

  return `${idPrefix}${time} ${msg.senderName}: ${content}`
}

/**
 * 格式化时间范围用于返回结果
 */
export function formatTimeRange(
  timeFilter?: { startTs: number; endTs: number },
  locale?: string
): string | { start: string; end: string } {
  if (!timeFilter) return t('allTime', locale) as string
  const localeStr = isChineseLocale(locale) ? 'zh-CN' : 'en-US'
  return {
    start: new Date(timeFilter.startTs * 1000).toLocaleString(localeStr),
    end: new Date(timeFilter.endTs * 1000).toLocaleString(localeStr),
  }
}

/**
 * 将工具返回的结构化数据格式化为 LLM 友好的纯文本
 */
export function formatToolResultAsText(details: Record<string, unknown>): string {
  const lines: string[] = []
  const messages = details.messages as string[] | undefined

  for (const [key, value] of Object.entries(details)) {
    if (key === 'messages') continue
    // raw message objects are already rendered via the formatted messages list;
    // joining them here would print "[object Object]" for every entry
    if (key === 'rawMessages') continue
    if (value === undefined || value === null) continue

    if (typeof value === 'object') {
      if ('start' in (value as Record<string, unknown>) && 'end' in (value as Record<string, unknown>)) {
        const range = value as { start: string; end: string }
        lines.push(`${key}: ${range.start} ~ ${range.end}`)
      } else if (Array.isArray(value)) {
        lines.push(`${key}: ${value.join(', ')}`)
      } else {
        lines.push(`${key}: ${JSON.stringify(value)}`)
      }
    } else {
      lines.push(`${key}: ${value}`)
    }
  }

  if (messages && messages.length > 0) {
    lines.push('')
    let lastDate = ''
    for (const msg of messages) {
      // [#id] citation prefixes (CLI agent format) must survive date grouping at line start
      const prefixMatch = /^(\[#[^\]]+\] )/.exec(msg)
      const prefix = prefixMatch ? prefixMatch[1] : ''
      const body = prefix ? msg.slice(prefix.length) : msg
      const spaceIdx = body.indexOf(' ')
      const secondSpaceIdx = body.indexOf(' ', spaceIdx + 1)
      if (spaceIdx > 0 && secondSpaceIdx > 0) {
        const date = body.slice(0, spaceIdx)
        const rest = body.slice(spaceIdx + 1)
        if (date !== lastDate) {
          lines.push(`--- ${date} ---`)
          lastDate = date
        }
        lines.push(prefix + rest)
      } else {
        lines.push(msg)
      }
    }
  }

  return lines.join('\n')
}

/**
 * 昵称匿名化：用 U{senderId} 替代真实昵称
 * 就地修改 messages 的 senderName，返回映射表文本行
 */
export function anonymizeMessageNames(
  messages: Array<{ senderId?: number; senderName: string; senderPlatformId?: string }>,
  ownerPlatformId?: string
): string {
  const nameMap = new Map<number, { name: string; platformId?: string }>()
  for (const msg of messages) {
    if (msg.senderId != null && !nameMap.has(msg.senderId)) {
      nameMap.set(msg.senderId, { name: msg.senderName, platformId: msg.senderPlatformId })
    }
  }

  if (nameMap.size === 0) return ''

  for (const msg of messages) {
    if (msg.senderId != null) {
      msg.senderName = `U${msg.senderId}`
    }
  }

  const entries: string[] = []
  for (const [id, { name, platformId }] of nameMap) {
    const isOwner = ownerPlatformId && platformId === ownerPlatformId
    entries.push(`U${id}=${name}${isOwner ? '(owner)' : ''}`)
  }

  return `[Name Map] ${entries.join(' | ')}`
}

/**
 * Token-aware 截断：在 token 预算内保留尽可能多的消息
 */
export function truncateFormattedMessages(
  formatted: string[],
  maxTokens: number,
  strategy: 'keep_first' | 'keep_last',
  countTokensFn: (text: string) => number
): { messages: string[]; wasTruncated: boolean } {
  const budget = maxTokens - 200

  let totalTokens = 0
  for (const line of formatted) {
    totalTokens += countTokensFn(line) + 1
  }
  if (totalTokens <= budget) {
    return { messages: formatted, wasTruncated: false }
  }

  if (strategy === 'keep_first') {
    let tokens = 0
    let cutIndex = formatted.length
    for (let i = 0; i < formatted.length; i++) {
      tokens += countTokensFn(formatted[i]) + 1
      if (tokens > budget) {
        cutIndex = i
        break
      }
    }
    return { messages: formatted.slice(0, cutIndex), wasTruncated: cutIndex < formatted.length }
  } else {
    let tokens = 0
    let cutIndex = 0
    for (let i = formatted.length - 1; i >= 0; i--) {
      tokens += countTokensFn(formatted[i]) + 1
      if (tokens > budget) {
        cutIndex = i + 1
        break
      }
    }
    return { messages: formatted.slice(cutIndex), wasTruncated: cutIndex > 0 }
  }
}
