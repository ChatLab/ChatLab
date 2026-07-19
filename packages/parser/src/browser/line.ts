import { ChatType, KNOWN_PLATFORMS, MessageType } from '@openchatlab/shared-types'
import type { ParsedMember, ParsedMessage } from '@openchatlab/shared-types'

import type { ParsedMeta } from '../types'

export const LINE_HEAD_SIGNATURES = [
  /^\[LINE\] /m,
  /^(?:\[LINE\] )?Chat history (?:with|in) /m,
  /^((?:上午|下午|午前|午後)?\d{1,2}:\d{2}(?:[AaPp][Mm])?)\t[^\t\n]+\t/m,
  /^((?:上午|下午|午前|午後)?\d{1,2}:\d{2}(?:[AaPp][Mm])?) [^\s]+ /m,
  /^\d{4}\.\d{2}\.\d{2}\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/m,
  /^\d{4}\/\d{1,2}\/\d{1,2}[（(][月火水木金土日]/m,
  /^\d{4}\/\d{1,2}\/\d{1,2}周/m,
]

export const LINE_FILENAME_SIGNATURES = [/\[LINE\]/i]

export interface LineTextParseOptions {
  checkCancelled?: () => void
  onProgress?: (progress: { progress: number; messagesProcessed: number }) => void
  yieldEvery?: number
  now?: () => Date
}

export interface LineTextParseResult {
  meta: ParsedMeta
  members: ParsedMember[]
  messages: ParsedMessage[]
}

interface LineHeader {
  name: string
  isGroup: boolean
}

const DATE_PATTERNS = [
  /^(\d{4})\.(\d{2})\.(\d{2})\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?/,
  /^(\d{4})\/(\d{1,2})\/(\d{1,2})/,
  /^[A-Za-z]+,\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/,
]

const TAB_MESSAGE_PATTERN = /^((?:上午|下午|午前|午後)?\d{1,2}:\d{2}(?:[AaPp][Mm])?)\t([^\t]+)\t(.*)$/
const SPACE_MESSAGE_PATTERN = /^((?:上午|下午|午前|午後)?\d{1,2}:\d{2}(?:[AaPp][Mm])?) ([^\s]+) (.*)$/
const SYSTEM_MESSAGE_PATTERN = /^((?:上午|下午|午前|午後)?\d{1,2}:\d{2}(?:[AaPp][Mm])?)\t\t(.+)$/

const SPECIAL_MESSAGE_TYPES: Record<string, MessageType> = {
  '[Photo]': MessageType.IMAGE,
  '[照片]': MessageType.IMAGE,
  '[写真]': MessageType.IMAGE,
  Photos: MessageType.IMAGE,
  '[Voice message]': MessageType.VOICE,
  '[语音信息]': MessageType.VOICE,
  '[語音訊息]': MessageType.VOICE,
  '[ボイスメッセージ]': MessageType.VOICE,
  Audio: MessageType.VOICE,
  '[Video]': MessageType.VIDEO,
  '[视频]': MessageType.VIDEO,
  '[影片]': MessageType.VIDEO,
  '[動画]': MessageType.VIDEO,
  Videos: MessageType.VIDEO,
  '[File]': MessageType.FILE,
  '[文件]': MessageType.FILE,
  '[檔案]': MessageType.FILE,
  '[ファイル]': MessageType.FILE,
  '[Sticker]': MessageType.EMOJI,
  '[贴图]': MessageType.EMOJI,
  '[貼圖]': MessageType.EMOJI,
  '[スタンプ]': MessageType.EMOJI,
  Stickers: MessageType.EMOJI,
  '[Location]': MessageType.LOCATION,
  '[位置]': MessageType.LOCATION,
  '[位置情報]': MessageType.LOCATION,
  '[Notes]': MessageType.TEXT,
  '[记事本]': MessageType.TEXT,
  '[記事本]': MessageType.TEXT,
  '[ノート]': MessageType.TEXT,
}

export function detectLineText(head: string, fileName: string): boolean {
  const basename = getBasename(fileName)
  if (!basename.toLowerCase().endsWith('.txt')) return false
  return (
    LINE_HEAD_SIGNATURES.some((signature) => signature.test(head)) ||
    LINE_FILENAME_SIGNATURES.some((signature) => signature.test(basename))
  )
}

export async function parseLineText(
  content: string,
  fileName: string,
  options: LineTextParseOptions = {}
): Promise<LineTextParseResult> {
  const lines = content.split('\n').map((line) => line.replace(/\r$/, ''))
  const memberMap = new Map<string, ParsedMember>()
  const messages: ParsedMessage[] = []
  const header = lines.length > 0 ? extractNameFromHeader(lines[0].trim()) : null
  const chatName = header?.name ?? extractNameFromFileName(fileName)
  let currentDate: Date | null = null
  let lastMessage: ParsedMessage | null = null
  let quotedMultiline = false
  let lineIndex = header ? 3 : 0
  let useTabSeparator = Boolean(header)
  const yieldEvery = Math.max(1, options.yieldEvery ?? 1000)

  if (!header) {
    for (const line of lines) {
      if (TAB_MESSAGE_PATTERN.test(line)) {
        useTabSeparator = true
        break
      }
      if (SPACE_MESSAGE_PATTERN.test(line)) {
        useTabSeparator = false
        break
      }
    }
  }

  for (; lineIndex < lines.length; lineIndex += 1) {
    options.checkCancelled?.()
    const line = lines[lineIndex]
    const date = parseDateLine(line)
    if (date) {
      currentDate = date
    } else {
      const messagePattern = useTabSeparator ? TAB_MESSAGE_PATTERN : SPACE_MESSAGE_PATTERN
      const messageMatch = line.match(messagePattern)
      if (messageMatch) {
        const [, timeText, sender, rawContent] = messageMatch
        let messageContent = rawContent.trim()
        quotedMultiline = false
        if (messageContent.startsWith('"')) {
          messageContent = messageContent.slice(1)
          quotedMultiline = !messageContent.endsWith('"')
          if (!quotedMultiline) messageContent = messageContent.slice(0, -1)
        }

        if (!memberMap.has(sender)) {
          memberMap.set(sender, { platformId: sender, accountName: sender })
        }
        lastMessage = {
          senderPlatformId: sender,
          senderAccountName: sender,
          timestamp: buildTimestamp(currentDate, timeText, options.now),
          type: detectMessageType(messageContent),
          content: messageContent || null,
        }
        messages.push(lastMessage)
      } else {
        const systemMatch = line.match(SYSTEM_MESSAGE_PATTERN)
        if (systemMatch) {
          const [, timeText, rawContent] = systemMatch
          const messageContent = rawContent.trim()
          quotedMultiline = false
          lastMessage = {
            senderPlatformId: 'system',
            senderAccountName: '系統',
            timestamp: buildTimestamp(currentDate, timeText, options.now),
            type: MessageType.SYSTEM,
            content: messageContent || null,
          }
          messages.push(lastMessage)
        } else if (line.trim() && lastMessage) {
          let continuation = line
          if (quotedMultiline && continuation.endsWith('"')) {
            continuation = continuation.slice(0, -1)
            quotedMultiline = false
          }
          lastMessage.content = lastMessage.content ? `${lastMessage.content}\n${continuation}` : continuation
        }
      }
    }

    if (lineIndex > 0 && lineIndex % yieldEvery === 0) {
      options.onProgress?.({ progress: lineIndex / lines.length, messagesProcessed: messages.length })
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      options.checkCancelled?.()
    }
  }

  options.checkCancelled?.()
  const memberCount = memberMap.size
  const chatType = header
    ? header.isGroup
      ? ChatType.GROUP
      : ChatType.PRIVATE
    : memberCount <= 2
      ? ChatType.PRIVATE
      : ChatType.GROUP
  const result = {
    meta: { name: chatName, platform: KNOWN_PLATFORMS.LINE, type: chatType },
    members: Array.from(memberMap.values()),
    messages,
  }
  options.onProgress?.({ progress: 1, messagesProcessed: messages.length })
  return result
}

function extractNameFromFileName(fileName: string): string {
  const basename = getBasename(fileName).replace(/\.txt$/, '')
  return basename.replace(/^\[LINE\]\s*/i, '').trim() || '未知聊天'
}

function extractNameFromHeader(header: string): LineHeader | null {
  const englishPrivate = header.match(/^(?:\[LINE\] )?Chat history with (.+)$/m)
  if (englishPrivate) return { name: englishPrivate[1].trim(), isGroup: false }
  const englishGroup = header.match(/^(?:\[LINE\] )?Chat history in (.+)$/m)
  if (englishGroup) return { name: englishGroup[1].trim(), isGroup: true }
  const japanesePrivate = header.match(/^\[LINE\] (.+)とのトーク履歴/)
  if (japanesePrivate) return { name: japanesePrivate[1].trim(), isGroup: false }
  const japaneseGroup = header.match(/^\[LINE\] (.+)のトーク履歴/)
  if (japaneseGroup) return { name: japaneseGroup[1].trim(), isGroup: true }
  const simplifiedPrivate = header.match(/^\[LINE\] 与(.+)的聊天记录/)
  if (simplifiedPrivate) return { name: simplifiedPrivate[1].trim(), isGroup: false }
  const simplifiedGroup = header.match(/^\[LINE\] (.+)的聊天记录/)
  if (simplifiedGroup) return { name: simplifiedGroup[1].trim(), isGroup: true }
  const traditionalPrivate = header.match(/^\[LINE\] 與(.+)的聊天記錄/)
  if (traditionalPrivate) return { name: traditionalPrivate[1].trim(), isGroup: false }
  const traditionalGroup = header.match(/^\[LINE\] (.+)的聊天記錄/)
  return traditionalGroup ? { name: traditionalGroup[1].trim(), isGroup: true } : null
}

function getBasename(fileName: string): string {
  return fileName.split(/[\\/]/).pop() ?? fileName
}

function parseDateLine(line: string): Date | null {
  for (let index = 0; index < DATE_PATTERNS.length; index += 1) {
    const match = line.match(DATE_PATTERNS[index])
    if (!match) continue
    if (index < 2) {
      return new Date(Number.parseInt(match[1], 10), Number.parseInt(match[2], 10) - 1, Number.parseInt(match[3], 10))
    }
    return new Date(Number.parseInt(match[3], 10), Number.parseInt(match[1], 10) - 1, Number.parseInt(match[2], 10))
  }
  return null
}

function buildTimestamp(currentDate: Date | null, timeText: string, now: (() => Date) | undefined): number {
  const { hours, minutes } = parseTime(timeText)
  const value = currentDate ? new Date(currentDate) : (now?.() ?? new Date())
  value.setHours(hours, minutes, 0, 0)
  return Math.floor(value.getTime() / 1000)
}

function parseTime(timeText: string): { hours: number; minutes: number } {
  const prefix = timeText.match(/^(上午|下午|午前|午後)/)?.[1]
  const cleanTime = timeText.replace(/^(上午|下午|午前|午後)/, '')
  const match = cleanTime.match(/^(\d{1,2}):(\d{2})([AaPp][Mm])?$/i)
  if (!match) {
    const [hours, minutes] = timeText.split(':').map(Number)
    return { hours, minutes }
  }

  let hours = Number.parseInt(match[1], 10)
  const minutes = Number.parseInt(match[2], 10)
  const suffix = match[3]?.toLowerCase()
  if (suffix === 'pm' && hours < 12) hours += 12
  if (suffix === 'am' && hours === 12) hours = 0
  if ((prefix === '下午' || prefix === '午後') && hours < 12) hours += 12
  if ((prefix === '上午' || prefix === '午前') && hours === 12) hours = 0
  return { hours, minutes }
}

function detectMessageType(content: string): MessageType {
  for (const [pattern, type] of Object.entries(SPECIAL_MESSAGE_TYPES)) {
    if (content === pattern || content.startsWith(pattern)) return type
  }
  if (content.startsWith('[null]') && content.includes('maps.google.com')) return MessageType.LOCATION
  if (
    content.includes(' joined the group') ||
    content.includes('已加入该群') ||
    content.includes('已加入群組') ||
    content.includes('がグループに参加しました') ||
    content.includes(' added ') ||
    content.includes(' to the group') ||
    content.includes('已将') ||
    content.includes('添加至群') ||
    content.includes('添加到群') ||
    content.includes('已新增') ||
    content.includes('至群組') ||
    content.includes('をグループに追加しました') ||
    content.includes(' left the group') ||
    content.includes('已退群') ||
    content.includes('已離開群組') ||
    content.includes('がグループを退会しました') ||
    content.includes('made an announcement') ||
    content.includes('发布了通告') ||
    content.includes('已設定公告') ||
    content.includes('がアナウンスしました') ||
    content.includes('unsent a message') ||
    content === 'Message unsent.' ||
    content.includes('撤回了一条消息') ||
    content.includes('已收回訊息') ||
    content.includes('送信を取り消しました') ||
    content.startsWith('Auto-reply')
  ) {
    return MessageType.SYSTEM
  }
  return /^https?:\/\//.test(content) ? MessageType.LINK : MessageType.TEXT
}
