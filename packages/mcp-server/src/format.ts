/**
 * MCP output formatting for token-efficient LLM consumption
 *
 * Provides message filtering, merging, truncation, and compact text output.
 * Inspired by community chatlab-mcp-server's format.ts.
 */

const MAX_CONTENT_LENGTH = 200
const MAX_MERGED_CONTENT_LENGTH = 400

const PLACEHOLDER_CONTENTS = new Set([
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
  '[分享]',
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
  '[share]',
])

const MEANINGLESS_SHORT_EN = new Set([
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
])

const MEANINGFUL_SHORT_ZH = new Set(['好的', '不是', '是的', '可以', '不行', '好吧', '明白', '知道', '同意'])

const SYSTEM_PATTERNS_ZH = [/^.*邀请.*加入了群聊$/, /^.*退出了群聊$/, /^.*撤回了一条消息$/, /^你撤回了一条消息$/]

const SYSTEM_PATTERNS_EN = [
  /^.*invited.*to the group$/i,
  /^.*left the group$/i,
  /^.*recalled a message$/i,
  /^.*joined the group$/i,
  /^.*has been removed$/i,
]

const EMOJI_ONLY = /^[\p{Emoji}\s[\]（）()]+$/u

interface FormattableMessage {
  senderName: string
  content: string | null
  timestamp: number
}

/**
 * Check if message content is meaningful (not noise).
 */
export function isValidMessage(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed) return false

  if (trimmed.length <= 2 && !MEANINGFUL_SHORT_ZH.has(trimmed)) return false
  if (MEANINGLESS_SHORT_EN.has(trimmed.toLowerCase())) return false
  if (EMOJI_ONLY.test(trimmed)) return false
  if (PLACEHOLDER_CONTENTS.has(trimmed.toLowerCase())) return false
  if (SYSTEM_PATTERNS_ZH.some((p) => p.test(trimmed))) return false
  if (SYSTEM_PATTERNS_EN.some((p) => p.test(trimmed))) return false

  return true
}

function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen) + '...'
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts * 1000)
  const M = d.getMonth() + 1
  const D = d.getDate()
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${M}/${D} ${h}:${m}`
}

/**
 * Format messages as compact plain text with consecutive-sender merging.
 * Filters out noise messages, merges same-sender runs, truncates long content.
 */
export function formatMessagesCompact(messages: FormattableMessage[]): string {
  if (messages.length === 0) return ''

  const valid = messages.filter((m) => m.content && isValidMessage(m.content))
  if (valid.length === 0) return ''

  const lines: string[] = []
  let prevSender = ''
  let pendingContents: string[] = []
  let pendingTs = 0

  const flush = () => {
    if (pendingContents.length === 0) return
    const combined = pendingContents.join('; ')
    const maxLen = pendingContents.length > 1 ? MAX_MERGED_CONTENT_LENGTH : MAX_CONTENT_LENGTH
    lines.push(`${formatTimestamp(pendingTs)} ${prevSender}: ${truncate(combined, maxLen)}`)
  }

  for (const msg of valid) {
    const content = msg.content!.trim()
    if (msg.senderName === prevSender) {
      pendingContents.push(content)
    } else {
      flush()
      prevSender = msg.senderName
      pendingContents = [content]
      pendingTs = msg.timestamp
    }
  }
  flush()

  return lines.join('\n')
}

/**
 * Try to parse a tool result's JSON content and convert to compact text.
 * Returns null if the content is not suitable for text formatting.
 */
export function formatToolResultAsText(content: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>

  // If there's a messages array with senderName/content/timestamp, format it
  if (Array.isArray(obj.messages) && obj.messages.length > 0) {
    const msgs = obj.messages as FormattableMessage[]
    if (msgs[0] && 'senderName' in msgs[0] && 'timestamp' in msgs[0]) {
      return formatObjectWithMessages(obj, msgs)
    }
  }

  // If there are ranking/keywords arrays, format as numbered list
  if (Array.isArray(obj.ranking) || Array.isArray(obj.keywords)) {
    return formatArrayResult(obj)
  }

  // If there are sessions, format them compactly
  if (Array.isArray(obj.sessions)) {
    return formatSessionsList(obj)
  }

  return null
}

function formatObjectWithMessages(obj: Record<string, unknown>, msgs: FormattableMessage[]): string {
  const lines: string[] = []

  for (const [key, value] of Object.entries(obj)) {
    if (key === 'messages') continue
    if (value === undefined || value === null) continue
    if (typeof value === 'object' && !Array.isArray(value)) continue
    if (Array.isArray(value)) continue
    lines.push(`${key}: ${value}`)
  }

  const formatted = formatMessagesCompact(msgs)
  if (formatted) {
    if (lines.length > 0) lines.push('')
    lines.push(formatted)
  }

  return lines.join('\n')
}

function formatArrayResult(obj: Record<string, unknown>): string {
  const lines: string[] = []

  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
      if (lines.length > 0) lines.push('')
      lines.push(...value)
    } else if (!Array.isArray(value) && value !== undefined && value !== null) {
      lines.push(`${key}: ${value}`)
    }
  }

  return lines.join('\n')
}

function formatSessionsList(obj: Record<string, unknown>): string {
  const sessions = obj.sessions as Array<Record<string, unknown>>
  const total = obj.total ?? sessions.length
  const lines: string[] = [`${total} sessions:`]

  for (const s of sessions) {
    const name = s.name ?? s.id
    const platform = s.platform ? ` (${s.platform})` : ''
    const msgCount = s.totalMessages ?? s.messageCount ?? ''
    const members = s.totalMembers ?? s.memberCount ?? ''
    const stats = msgCount ? ` — ${msgCount} msgs, ${members} members` : ''
    lines.push(`- ${name}${platform}${stats} [${s.id}]`)
  }

  return lines.join('\n')
}
