import { ChatType, KNOWN_PLATFORMS, MessageType } from '@openchatlab/shared-types'
import type { ParsedMember, ParsedMessage } from '@openchatlab/shared-types'

export interface WeFlowParsedMeta {
  name: string
  platform: string
  type: ChatType
  groupId?: string
  groupAvatar?: string
  ownerId?: string
}

export interface WeFlowJsonParseResult {
  meta: WeFlowParsedMeta
  members: ParsedMember[]
  messages: ParsedMessage[]
}

export interface WeFlowJsonParseOptions {
  checkCancelled?: () => void
  onProgress?: (progress: { progress: number; messagesProcessed: number }) => void
  yieldEvery?: number
}

interface MemberState {
  platformId: string
  accountName: string
  avatar?: string
}

export function detectWeFlowJson(content: string, fileName: string): boolean {
  return (
    fileName.toLowerCase().endsWith('.json') && /"weflow"\s*:\s*\{/.test(content) && /"session"\s*:\s*\{/.test(content)
  )
}

export async function parseWeFlowJson(
  content: string,
  fileName: string,
  options: WeFlowJsonParseOptions = {}
): Promise<WeFlowJsonParseResult> {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch (error) {
    throw new Error('Invalid WeFlow JSON export', { cause: error })
  }
  if (!isRecord(value) || !isRecord(value.weflow) || !isRecord(value.session)) {
    throw new Error('Invalid WeFlow JSON export: weflow and session objects are required')
  }

  const session = value.session
  const sessionId = stringValue(session.wxid)
  const type =
    session.type === '私聊' || (session.type !== '群聊' && sessionId !== undefined && !sessionId.endsWith('@chatroom'))
      ? ChatType.PRIVATE
      : ChatType.GROUP
  const groupId = type === ChatType.GROUP ? sessionId : undefined
  const avatars = readAvatars(value.avatars)
  const groupAvatar = stringValue(session.avatar) || (groupId ? avatars.get(groupId) : undefined)
  const messageValues = Array.isArray(value.messages) ? value.messages : []
  const members = new Map<string, MemberState>()
  const messages: ParsedMessage[] = []
  let ownerId: string | undefined

  for (let index = 0; index < messageValues.length; index += 1) {
    await cooperate(index, options)
    const message = messageValues[index]
    if (!isRecord(message)) continue

    const sender = stringValue(message.senderUsername)
    if (!sender || !Object.hasOwn(message, 'createTime') || sender.endsWith('@chatroom')) continue
    if (ownerId === undefined && message.isSend === 1) ownerId = sender

    const accountName = stringValue(message.senderDisplayName) || sender
    const avatarKey = stringValue(message.senderAvatarKey) || sender
    const avatar = avatars.get(avatarKey)
    const current = members.get(sender)
    if (current) {
      current.accountName = accountName
      if (avatar) current.avatar = avatar
    } else {
      members.set(sender, { platformId: sender, accountName, avatar })
    }

    messages.push({
      platformMessageId: String(message.localId),
      senderPlatformId: sender,
      senderAccountName: accountName,
      senderGroupNickname: undefined,
      timestamp: message.createTime as number,
      type: convertMessageType(stringValue(message.type)),
      content: normalizeContent(message.content),
    })
    options.onProgress?.({
      progress: messageValues.length === 0 ? 1 : (index + 1) / messageValues.length,
      messagesProcessed: messages.length,
    })
  }

  options.checkCancelled?.()
  options.onProgress?.({ progress: 1, messagesProcessed: messages.length })
  return {
    meta: {
      name: stringValue(session.displayName) || stringValue(session.nickname) || nameFromFilename(fileName),
      platform: KNOWN_PLATFORMS.WECHAT,
      type,
      groupId,
      groupAvatar,
      ownerId,
    },
    members: [...members.values()],
    messages,
  }
}

function readAvatars(value: unknown): Map<string, string> {
  const result = new Map<string, string>()
  if (!isRecord(value)) return result
  for (const [id, avatar] of Object.entries(value)) {
    if (typeof avatar === 'string' && avatar.length > 0) result.set(id, avatar)
  }
  return result
}

function convertMessageType(type: string | undefined): MessageType {
  switch (type) {
    case '文本消息':
      return MessageType.TEXT
    case '图片消息':
      return MessageType.IMAGE
    case '语音消息':
      return MessageType.VOICE
    case '视频消息':
      return MessageType.VIDEO
    case '文件消息':
      return MessageType.FILE
    case '动画表情':
      return MessageType.EMOJI
    case '名片消息':
      return MessageType.CONTACT
    case '卡片式链接':
    case '图文消息':
      return MessageType.LINK
    case '位置消息':
      return MessageType.LOCATION
    case '红包卡片':
      return MessageType.RED_PACKET
    case '转账卡片':
      return MessageType.TRANSFER
    case '小程序分享':
    case '视频号直播卡片':
      return MessageType.SHARE
    case '引用消息':
      return MessageType.REPLY
    case '聊天记录合并转发':
      return MessageType.FORWARD
    case '系统消息':
      return MessageType.SYSTEM
    default:
      return MessageType.OTHER
  }
}

function normalizeContent(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const content = (typeof value === 'string' ? value : JSON.stringify(value)).trim()
  return content || null
}

function nameFromFilename(fileName: string): string {
  const name = fileName
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/\.json$/i, '')
  return name || '未知聊天'
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function cooperate(index: number, options: WeFlowJsonParseOptions): Promise<void> {
  options.checkCancelled?.()
  const yieldEvery = Math.max(1, options.yieldEvery ?? 1000)
  if (index > 0 && index % yieldEvery === 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    options.checkCancelled?.()
  }
}
