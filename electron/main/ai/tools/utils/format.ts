/**
 * 工具结果格式化 & i18n 辅助
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

export function t(key: keyof typeof i18nTexts, locale?: string): string | string[] {
  const text = i18nTexts[key]
  if (typeof text === 'object' && 'zh' in text && 'en' in text) {
    return isChineseLocale(locale) ? text.zh : text.en
  }
  return ''
}

const MAX_MESSAGE_CONTENT_LENGTH = 200

/**
 * 格式化消息为简洁文本格式
 * 输出格式: "2025/3/3 07:25:04 张三: 消息内容"
 */
export function formatMessageCompact(
  msg: {
    id?: number
    senderName: string
    content: string | null
    timestamp: number
  },
  locale?: string
): string {
  const localeStr = isChineseLocale(locale) ? 'zh-CN' : 'en-US'
  const time = new Date(msg.timestamp * 1000).toLocaleString(localeStr)
  let content = msg.content || (t('noContent', locale) as string)

  if (content.length > MAX_MESSAGE_CONTENT_LENGTH) {
    content = content.slice(0, MAX_MESSAGE_CONTENT_LENGTH) + '...'
  }

  return `${time} ${msg.senderName}: ${content}`
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
