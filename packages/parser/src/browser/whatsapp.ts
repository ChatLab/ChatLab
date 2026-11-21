import { ChatType, KNOWN_PLATFORMS, MessageType } from '@openchatlab/shared-types'
import type { ParsedMember, ParsedMessage } from '@openchatlab/shared-types'

import type { ParsedMeta } from '../types'

export const WHATSAPP_HEAD_SIGNATURES = [
  /消息和通话已进行端到端加密/,
  /訊息與通話已受端對端加密保護/,
  /Messages and calls are end-to-end encrypted/i,
  /你发送给自己的消息已进行端到端加密/,
  /(?:\d{1,4}\/\d{1,2}\/\d{2,4}|\d{1,4}\.\d{1,2}\.\d{2,4}),?\s+\d{1,2}:\d{2}(?::\d{2})?(?:[\s\u2009\u202F]*(?:AM|PM|A\.M\.|P\.M\.|\u4e0a午|\u4e0b午|\u5348前|\u5348後|오전|오후))?\s+- /i,
  /\[(?:\d{1,4}\/\d{1,2}\/\d{1,4}|\d{1,4}\.\d{1,2}\.\d{2,4})[\s,].*\d{1,2}:\d{2}(?::\d{2})?.*\] /,
]

export const WHATSAPP_FILENAME_SIGNATURES = [
  /^与.+的\s*WhatsApp\s*聊天\.txt$/i,
  /^與.+的\s*WhatsApp\s*對話\.txt$/i,
  /WhatsApp/i,
]

export interface WhatsAppTextParseOptions {
  checkCancelled?: () => void
  onProgress?: (progress: { progress: number; messagesProcessed: number }) => void
  yieldEvery?: number
}

export interface WhatsAppTextParseResult {
  meta: ParsedMeta
  members: ParsedMember[]
  messages: ParsedMessage[]
  skippedLines: number
}

interface MemberInfo {
  platformId: string
  nickname: string
}

interface PendingMessage {
  timestamp: number
  timestampCandidates: TimestampCandidates
  sender: string | null
  contentLines: string[]
  isSystem: boolean
}

type DateOrderPreference = 'dmy' | 'mdy' | 'ymd'

interface TimestampCandidates {
  defaultOrder: DateOrderPreference
  dmy: number | null
  mdy: number | null
  ymd: number | null
}

const MESSAGE_LINE_REGEX_V1 =
  /^((?:\d{1,4}\/\d{1,2}\/\d{2,4}|\d{1,4}\.\d{1,2}\.\d{2,4}),?\s+\d{1,2}:\d{2}(?::\d{2})?(?:[\s\u2009\u202F]*(?:AM|PM|A\.M\.|P\.M\.|\u4e0a午|\u4e0b午|\u5348前|\u5348後|오전|오후))?) - (.+)$/i
const MESSAGE_LINE_REGEX_V2 = /^\[([^\]]+)\] (.+)$/
const SENDER_CONTENT_REGEX = /^(.+?):[\s\u200E]*(.*)$/

const SYSTEM_MESSAGE_PATTERNS = [
  /消息和通话已进行端到端加密/,
  /创建了此群组/,
  /加入群组/,
  /添加了/,
  /退出了群组/,
  /移除了/,
  /更改了本群组/,
  /已将此群组的设置更改为/,
  /这条消息已删除/,
  /限时消息功能/,
  /正在等待此消息/,
  /訊息與通話已受端對端加密保護/,
  /建立了此群組/,
  /加入了群組/,
  /已新增/,
  /已離開群組/,
  /已移除/,
  /已變更本群組/,
  /此訊息已刪除/,
  /限時訊息/,
  /Messages and calls are end-to-end encrypted/i,
  /created this group/i,
  /joined the group/i,
  /added/i,
  /left the group/i,
  /removed/i,
  /changed this group/i,
  /This message was deleted/i,
  /disappearing messages/i,
]
const SYSTEM_MESSAGE_REGEX = new RegExp(SYSTEM_MESSAGE_PATTERNS.map((pattern) => pattern.source).join('|'), 'i')

const TIMESTAMP_SPACING = String.raw`(?:\s|\u2009|\u202F|\uFEFF|\u200E|\u200F|\u200B|\u200C|\u200D|\u2060)`
const COMMON_TIMESTAMP_REGEX = new RegExp(
  String.raw`^${TIMESTAMP_SPACING}*(\d{1,4})([\/.])(\d{1,2})\2(\d{1,4})(?:,|${TIMESTAMP_SPACING})+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:${TIMESTAMP_SPACING}+(AM|PM|A\.M\.|P\.M\.|上午|下午|午前|午後|오전|오후))?${TIMESTAMP_SPACING}*$`,
  'i'
)

const AMPM_MARKERS: [RegExp, boolean][] = [
  [/\bPM\b/i, true],
  [/\bP\.M\.(?!\w)/i, true],
  [/下午/, true],
  [/午後/, true],
  [/오후/, true],
  [/\bAM\b/i, false],
  [/\bA\.M\.(?!\w)/i, false],
  [/上午/, false],
  [/午前/, false],
  [/오전/, false],
]

export function detectWhatsAppText(head: string, fileName: string): boolean {
  const basename = getBasename(fileName)
  if (!basename.toLowerCase().endsWith('.txt')) return false
  return (
    WHATSAPP_HEAD_SIGNATURES.some((signature) => signature.test(head)) ||
    WHATSAPP_FILENAME_SIGNATURES.some((signature) => signature.test(basename))
  )
}

export async function parseWhatsAppText(
  content: string,
  fileName: string,
  options: WhatsAppTextParseOptions = {}
): Promise<WhatsAppTextParseResult> {
  const accumulator = new WhatsAppTextAccumulator(fileName)
  const lines = content.split('\n')
  const yieldEvery = Math.max(1, options.yieldEvery ?? 5000)

  for (let index = 0; index < lines.length; index += 1) {
    options.checkCancelled?.()
    accumulator.pushLine(lines[index])
    if (index > 0 && index % yieldEvery === 0) {
      options.onProgress?.({ progress: index / lines.length, messagesProcessed: accumulator.messageCount })
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      options.checkCancelled?.()
    }
  }

  options.checkCancelled?.()
  const result = accumulator.finish()
  options.onProgress?.({ progress: 1, messagesProcessed: result.messages.length })
  return result
}

export class WhatsAppTextAccumulator {
  private readonly fileChatName: string
  private readonly memberMap = new Map<string, MemberInfo>()
  private readonly messages: ParsedMessage[] = []
  private readonly messageTimestampCandidates: TimestampCandidates[] = []
  private currentMessage: PendingMessage | null = null
  private skippedLines = 0

  constructor(private readonly fileName: string) {
    this.fileChatName = extractNameFromFileName(fileName)
  }

  get messageCount(): number {
    return this.messages.length + (this.currentMessage ? 1 : 0)
  }

  pushLine(line: string): void {
    const cleanedLine = cleanLine(line)
    const v1Match = cleanedLine.match(MESSAGE_LINE_REGEX_V1)
    if (v1Match) {
      const candidates = parseFlexibleTimestampCandidates(v1Match[1])
      if (candidates !== null) {
        this.saveCurrentMessage()
        this.currentMessage = createPendingMessage(candidates, v1Match[2])
      } else {
        this.skippedLines += 1
      }
      return
    }

    const v2Match = cleanedLine.match(MESSAGE_LINE_REGEX_V2)
    if (v2Match) {
      const candidates = parseFlexibleTimestampCandidates(v2Match[1])
      if (candidates !== null) {
        this.saveCurrentMessage()
        this.currentMessage = createPendingMessage(candidates, v2Match[2])
        return
      }
      if (looksLikeHeaderPrefix(v2Match[1])) {
        this.skippedLines += 1
        return
      }
    }

    if (this.currentMessage && cleanedLine) {
      this.currentMessage.contentLines.push(cleanedLine)
    } else if (cleanedLine) {
      this.skippedLines += 1
    }
  }

  finish(): WhatsAppTextParseResult {
    this.saveCurrentMessage()
    resolveFileTimestamps(this.messages, this.messageTimestampCandidates)
    const chatType = this.memberMap.size > 2 ? ChatType.GROUP : ChatType.PRIVATE
    const chatName =
      chatType === ChatType.PRIVATE && shouldInferPrivateChatName(this.fileName, this.fileChatName)
        ? inferPrivateChatName(this.memberMap, this.fileChatName)
        : this.fileChatName

    return {
      meta: { name: chatName, platform: KNOWN_PLATFORMS.WHATSAPP, type: chatType },
      members: Array.from(this.memberMap.values(), (member) => ({
        platformId: member.platformId,
        accountName: member.nickname,
      })),
      messages: this.messages,
      skippedLines: this.skippedLines,
    }
  }

  private saveCurrentMessage(): void {
    if (!this.currentMessage) return
    const content = this.currentMessage.contentLines.join('\n').trim()
    const senderPlatformId = this.currentMessage.sender ?? 'system'
    const senderName = this.currentMessage.sender ?? '系统消息'

    this.messages.push({
      senderPlatformId,
      senderAccountName: senderName,
      timestamp: this.currentMessage.timestamp,
      type: detectMessageType(content, this.currentMessage.isSystem),
      content: content || null,
    })
    this.messageTimestampCandidates.push(this.currentMessage.timestampCandidates)
    if (this.currentMessage.sender) {
      this.memberMap.set(senderPlatformId, { platformId: senderPlatformId, nickname: senderName })
    }
    this.currentMessage = null
  }
}

function createPendingMessage(timestampCandidates: TimestampCandidates, restContent: string): PendingMessage {
  const timestamp = pickDefaultTimestamp(timestampCandidates)
  const senderMatch = restContent.match(SENDER_CONTENT_REGEX)
  const isSystem = isSystemMessage(restContent)
  if (senderMatch && !isSystem) {
    return {
      timestamp,
      timestampCandidates,
      sender: senderMatch[1].trim(),
      contentLines: [senderMatch[2]],
      isSystem,
    }
  }
  return { timestamp, timestampCandidates, sender: null, contentLines: [restContent], isSystem }
}

function extractNameFromFileName(fileName: string): string {
  const basename = getBasename(fileName)
  const simplifiedChinese = basename.match(/^与(.+?)的\s*WhatsApp\s*聊天\.txt$/i)
  if (simplifiedChinese) return simplifiedChinese[1].trim()
  const traditionalChinese = basename.match(/^與(.+?)的\s*WhatsApp\s*對話\.txt$/i)
  if (traditionalChinese) return traditionalChinese[1].trim()
  return basename.replace(/\.txt$/i, '') || '未知聊天'
}

function shouldInferPrivateChatName(fileName: string, fallbackName: string): boolean {
  const basename = getBasename(fileName)
  return /^_chat\.txt$/i.test(basename) || /^whatsapp(?:[-_\s].*)?$/i.test(fallbackName)
}

function inferPrivateChatName(memberMap: Map<string, MemberInfo>, fallbackName: string): string {
  return Array.from(memberMap.values()).find((member) => member.platformId !== 'system')?.nickname ?? fallbackName
}

function getBasename(fileName: string): string {
  return fileName.split(/[\\/]/).pop() ?? fileName
}

function cleanLine(line: string): string {
  return line.replace(/^(?:\uFEFF|\u200E|\u200F|\u200B|\u200C|\u200D|\u2060)+/, '').trim()
}

function isSystemMessage(content: string): boolean {
  return SYSTEM_MESSAGE_REGEX.test(content)
}

function detectMessageType(content: string, knownSystem = false): MessageType {
  const trimmed = content.trim()
  if (
    trimmed === '<省略影音内容>' ||
    trimmed === '<已省略多媒體檔案>' ||
    trimmed === '圖片已略去' ||
    trimmed === '影片已略去' ||
    trimmed === '音訊已略去' ||
    trimmed === 'image omitted' ||
    trimmed === 'video omitted' ||
    trimmed === 'audio omitted'
  ) {
    return MessageType.IMAGE
  }
  if (trimmed.includes('<已附加:') || trimmed.includes('<附件:') || trimmed.includes('<已附加：')) {
    return MessageType.FILE
  }
  if (trimmed === '貼圖已忽略' || trimmed === '貼圖已略去') return MessageType.EMOJI
  if (trimmed === '这条消息已删除' || trimmed.startsWith('此訊息已刪除') || trimmed.startsWith('你已刪除此訊息')) {
    return MessageType.RECALL
  }
  if (knownSystem || isSystemMessage(trimmed)) return MessageType.SYSTEM
  return MessageType.TEXT
}

function parseFlexibleTimestampCandidates(raw: string): TimestampCandidates | null {
  const commonMatch = raw.match(COMMON_TIMESTAMP_REGEX)
  if (commonMatch) {
    return buildTimestampCandidates(
      Number.parseInt(commonMatch[1], 10),
      Number.parseInt(commonMatch[3], 10),
      Number.parseInt(commonMatch[4], 10),
      Number.parseInt(commonMatch[5], 10),
      Number.parseInt(commonMatch[6], 10),
      Number.parseInt(commonMatch[7] ?? '0', 10),
      parseAmPm(commonMatch[8]),
      commonMatch[2] === '.'
    )
  }

  let value = raw.replace(/(?:\u2009|\u202F|\uFEFF|\u200E|\u200F|\u200B|\u200C|\u200D|\u2060)/g, ' ').trim()
  let isPm: boolean | null = null
  for (const [pattern, pm] of AMPM_MARKERS) {
    if (!pattern.test(value)) continue
    isPm = pm
    value = value.replace(pattern, '').trim()
    break
  }
  value = value.replace(/,/g, ' ').replace(/\s+/g, ' ').trim()

  const match = value.match(/^(\d{1,4})([/.])(\d{1,2})\2(\d{1,4})\s+(\d{1,2}:\d{2}(?::\d{2})?)$/)
  if (!match) return null
  const timeParts = match[5].split(':').map((part) => Number.parseInt(part, 10))

  return buildTimestampCandidates(
    Number.parseInt(match[1], 10),
    Number.parseInt(match[3], 10),
    Number.parseInt(match[4], 10),
    timeParts[0],
    timeParts[1],
    timeParts[2] ?? 0,
    isPm,
    match[2] === '.'
  )
}

function parseAmPm(marker: string | undefined): boolean | null {
  if (!marker) return null
  return /^(?:PM|P\.M\.|下午|午後|오후)$/i.test(marker)
}

function normalizeYear(rawYear: number): number | null {
  if (rawYear >= 1000 && rawYear <= 9999) return rawYear
  if (rawYear >= 0 && rawYear <= 99) return 2000 + rawYear
  return null
}

function looksLikeHeaderPrefix(raw: string): boolean {
  return /^(?:\s|\u2009|\u202F|\uFEFF|\u200E|\u200F|\u200B|\u200C|\u200D|\u2060)*\d{1,4}([/.])\d{1,2}\1\d{1,4}/.test(raw)
}

function buildValidatedEpochSeconds(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number
): number | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null
  const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day ||
    utcDate.getUTCHours() !== hour ||
    utcDate.getUTCMinutes() !== minute ||
    utcDate.getUTCSeconds() !== second
  ) {
    return null
  }
  const date = new Date(year, month - 1, day, hour, minute, second)
  const timestamp = Math.floor(date.getTime() / 1000)
  return Number.isNaN(timestamp) ? null : timestamp
}

function buildTimestampCandidates(
  firstDatePart: number,
  secondDatePart: number,
  thirdDatePart: number,
  rawHour: number,
  minute: number,
  second: number,
  isPm: boolean | null,
  dotSeparated = false
): TimestampCandidates | null {
  if (isPm !== null && (rawHour < 1 || rawHour > 12)) return null
  let hour = rawHour
  if (isPm === true && hour !== 12) hour += 12
  if (isPm === false && hour === 12) hour = 0

  const ymd =
    firstDatePart >= 1000
      ? buildValidatedEpochSeconds(firstDatePart, secondDatePart, thirdDatePart, hour, minute, second)
      : null

  const trailingYear = firstDatePart < 1000 ? normalizeYear(thirdDatePart) : null
  const dmy =
    trailingYear !== null
      ? buildValidatedEpochSeconds(trailingYear, secondDatePart, firstDatePart, hour, minute, second)
      : null
  const mdy =
    trailingYear !== null
      ? buildValidatedEpochSeconds(trailingYear, firstDatePart, secondDatePart, hour, minute, second)
      : null

  if (ymd === null && dmy === null && mdy === null) return null

  const defaultOrder: DateOrderPreference =
    firstDatePart >= 1000
      ? 'ymd'
      : thirdDatePart > 31 || dotSeparated
        ? 'dmy'
        : 'mdy'

  return { defaultOrder, dmy, mdy, ymd }
}

function pickDefaultTimestamp(candidates: TimestampCandidates): number {
  if (candidates.defaultOrder === 'ymd' && candidates.ymd !== null) return candidates.ymd
  if (candidates.defaultOrder === 'dmy') return (candidates.dmy ?? candidates.mdy ?? candidates.ymd)!
  return (candidates.mdy ?? candidates.dmy ?? candidates.ymd)!
}

function pickOrderedTimestamp(candidates: TimestampCandidates, order: 'dmy' | 'mdy'): number {
  if (candidates.ymd !== null && candidates.dmy === null && candidates.mdy === null) {
    return candidates.ymd
  }
  return order === 'dmy'
    ? (candidates.dmy ?? candidates.mdy ?? candidates.ymd)!
    : (candidates.mdy ?? candidates.dmy ?? candidates.ymd)!
}

function resolveFileTimestamps(messages: ParsedMessage[], candidatesList: TimestampCandidates[]): void {
  if (messages.length === 0) return

  let dmyEvidence = 0
  let mdyEvidence = 0
  for (const candidates of candidatesList) {
    if (candidates.dmy !== null && candidates.mdy === null) dmyEvidence += 1
    else if (candidates.mdy !== null && candidates.dmy === null) mdyEvidence += 1
  }

  let fileOrder: 'dmy' | 'mdy' | null = null
  if (dmyEvidence > 0 && mdyEvidence === 0) {
    fileOrder = 'dmy'
  } else if (mdyEvidence > 0 && dmyEvidence === 0) {
    fileOrder = 'mdy'
  } else if (dmyEvidence === 0 && mdyEvidence === 0) {
    const dmyInversions = countChronologicalInversions(candidatesList, 'dmy')
    const mdyInversions = countChronologicalInversions(candidatesList, 'mdy')
    if (dmyInversions < mdyInversions) fileOrder = 'dmy'
    else if (mdyInversions < dmyInversions) fileOrder = 'mdy'
  }

  for (let index = 0; index < messages.length; index += 1) {
    const candidates = candidatesList[index]
    messages[index].timestamp = fileOrder
      ? pickOrderedTimestamp(candidates, fileOrder)
      : pickDefaultTimestamp(candidates)
  }
}

function countChronologicalInversions(candidatesList: TimestampCandidates[], order: 'dmy' | 'mdy'): number {
  let inversions = 0
  let previous: number | null = null
  for (const candidates of candidatesList) {
    const current = pickOrderedTimestamp(candidates, order)
    if (previous !== null && current < previous) {
      inversions += 1
    }
    previous = current
  }
  return inversions
}
