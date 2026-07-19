import { ChatType, KNOWN_PLATFORMS, MessageType } from '@openchatlab/shared-types'
import type { ParsedMember, ParsedMessage } from '@openchatlab/shared-types'

import type { ParsedMeta } from '../types'

export const QQ_HEAD_SIGNATURES = [/消息记录（此消息记录为文本格式/, /消息对象:/, /多人聊天/]

export interface QqTextParseOptions {
  checkCancelled?: () => void
  onProgress?: (progress: { progress: number; messagesProcessed: number }) => void
  yieldEvery?: number
}

export interface QqTextParseResult {
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
  platformId: string
  nickname: string
  contentLines: string[]
}

const MESSAGE_HEADER_REGEX = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (.+?)(?:\(([^)]+)\)|<([^>]+)>)?$/
const GROUP_NAME_REGEX = /^消息对象:(.+)$/

export function detectQqText(head: string, fileName: string): boolean {
  const basename = getBasename(fileName)
  return basename.toLowerCase().endsWith('.txt') && QQ_HEAD_SIGNATURES.some((signature) => signature.test(head))
}

export async function parseQqText(
  content: string,
  fileName: string,
  options: QqTextParseOptions = {}
): Promise<QqTextParseResult> {
  const accumulator = new QqTextAccumulator(fileName)
  const lines = content.split('\n')
  const yieldEvery = Math.max(1, options.yieldEvery ?? 1000)

  for (let index = 0; index < lines.length; index += 1) {
    options.checkCancelled?.()
    accumulator.pushLine(lines[index].replace(/\r$/, ''))
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

export class QqTextAccumulator {
  private readonly fallbackName: string
  private readonly memberMap = new Map<string, MemberInfo>()
  private readonly lastValidNickname = new Map<string, string>()
  private readonly messages: ParsedMessage[] = []
  private groupName = '未知群聊'
  private currentMessage: PendingMessage | null = null
  private skippedLines = 0

  constructor(fileName: string) {
    this.fallbackName = extractNameFromFileName(fileName)
  }

  get messageCount(): number {
    return this.messages.length + (this.currentMessage ? 1 : 0)
  }

  pushLine(line: string): void {
    const groupMatch = line.match(GROUP_NAME_REGEX)
    if (groupMatch) {
      this.groupName = groupMatch[1].trim()
      return
    }

    const headerMatch = line.match(MESSAGE_HEADER_REGEX)
    if (headerMatch) {
      this.saveCurrentMessage()
      const platformId = headerMatch[3] || headerMatch[4] || cleanNickname(headerMatch[2].trim())
      let nickname = cleanNickname(headerMatch[2].trim())
      if (nickname === platformId && headerMatch[3]) {
        nickname = this.lastValidNickname.get(platformId) ?? nickname
      } else if (headerMatch[3] || headerMatch[4]) {
        this.lastValidNickname.set(platformId, nickname)
      }
      this.currentMessage = {
        timestamp: parseLocalTime(headerMatch[1]),
        platformId,
        nickname,
        contentLines: [],
      }
      return
    }

    if (this.currentMessage) {
      if (line.startsWith('=====') || line.startsWith('消息记录') || line.startsWith('消息分组')) return
      this.currentMessage.contentLines.push(line)
      return
    }

    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('=====') && !trimmed.startsWith('消息记录') && !trimmed.startsWith('消息分组')) {
      this.skippedLines += 1
    }
  }

  finish(): QqTextParseResult {
    this.saveCurrentMessage()
    return {
      meta: {
        name: this.groupName === '未知群聊' ? this.fallbackName : this.groupName,
        platform: KNOWN_PLATFORMS.QQ,
        type: ChatType.GROUP,
      },
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
    this.messages.push({
      senderPlatformId: this.currentMessage.platformId,
      senderAccountName: this.currentMessage.nickname,
      timestamp: this.currentMessage.timestamp,
      type: detectMessageType(content),
      content: content || null,
    })
    this.memberMap.set(this.currentMessage.platformId, {
      platformId: this.currentMessage.platformId,
      nickname: this.currentMessage.nickname,
    })
    this.currentMessage = null
  }
}

function extractNameFromFileName(fileName: string): string {
  return getBasename(fileName).replace(/\.txt$/i, '') || '未知群聊'
}

function getBasename(fileName: string): string {
  return fileName.split(/[\\/]/).pop() ?? fileName
}

function cleanNickname(nickname: string): string {
  return nickname.replace(/^(【[^】]*】\s*)+/, '').trim()
}

function parseLocalTime(timeText: string): number {
  return Math.floor(new Date(timeText.replace(' ', 'T')).getTime() / 1000)
}

function detectMessageType(content: string): MessageType {
  const trimmed = content.trim()
  if (trimmed === '[图片]') return MessageType.IMAGE
  if (trimmed === '[表情]') return MessageType.EMOJI
  if (trimmed === '[语音]') return MessageType.VOICE
  if (trimmed === '[视频]') return MessageType.VIDEO
  if (trimmed === '[文件]') return MessageType.FILE
  if (trimmed === '[位置]' || trimmed === '[地理位置]') return MessageType.LOCATION
  if (trimmed === '[链接]' || trimmed === '[卡片消息]') return MessageType.LINK
  if (trimmed === '[红包]' || trimmed.includes('发出了红包')) return MessageType.RED_PACKET
  if (trimmed === '[转账]' || trimmed.includes('向你转账')) return MessageType.TRANSFER
  if (trimmed.includes('拍了拍') || trimmed === '[拍一拍]') return MessageType.POKE
  if (trimmed === '[语音通话]' || trimmed === '[视频通话]' || trimmed.includes('通话时长')) {
    return MessageType.CALL
  }
  if (trimmed === '[分享]' || trimmed === '[音乐]' || trimmed === '[小程序]') return MessageType.SHARE
  if (trimmed.startsWith('[回复]')) return MessageType.REPLY
  if (trimmed === '[转发]' || trimmed === '[聊天记录]') return MessageType.FORWARD
  if (trimmed.includes('撤回了一条消息') || trimmed === '[撤回]') return MessageType.RECALL
  if (
    trimmed.includes('加入了群聊') ||
    trimmed.includes('退出了群聊') ||
    trimmed.includes('被移出群聊') ||
    trimmed.includes('修改了群名称') ||
    trimmed.includes('成为新群主') ||
    trimmed.includes('群公告')
  ) {
    return MessageType.SYSTEM
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return MessageType.OTHER
  return MessageType.TEXT
}
