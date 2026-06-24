/**
 * Google Chat Takeout 内部导入格式解析器。
 *
 * ZIP 读取与会话选择由 node-runtime 负责；本解析器只读取其生成的固定 manifest
 * 和同目录 JSON 文件，从而复用现有 streaming importer。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import streamChain from 'stream-chain'
import streamJson from 'stream-json'
import pickModule from 'stream-json/filters/Pick.js'
import streamValuesModule from 'stream-json/streamers/StreamValues.js'
import { ChatType, KNOWN_PLATFORMS, MessageType } from '@openchatlab/shared-types'
import type {
  FormatFeature,
  FormatModule,
  ParseEvent,
  ParseOptions,
  ParsedMember,
  ParsedMessage,
  Parser,
} from '../types'
import { createProgress, getFileSize } from '../utils'

const { chain } = streamChain
const { parser } = streamJson
const { pick } = pickModule
const { streamValues } = streamValuesModule

interface GoogleChatManifest {
  format: string
  version: number
  chatId: string
  chatType: 'private' | 'group'
  chatName?: string
  userInfoFile: string
  groupInfoFile: string
  messagesFile: string
}

interface GoogleChatUser {
  email?: string
  name?: string
  user_type?: string
}

interface GoogleChatUserInfo {
  user?: GoogleChatUser
}

interface GoogleChatGroupInfo {
  name?: string
  members?: GoogleChatUser[]
}

interface GoogleChatAttachment {
  original_name?: string
  export_name?: string
}

interface GoogleChatQuotedMessage {
  creator?: GoogleChatUser
  text?: string
}

interface GoogleChatMessage {
  message_id?: string
  created_date?: string
  updated_date?: string
  creator?: GoogleChatUser
  text?: string
  attached_files?: GoogleChatAttachment[]
  quoted_message_metadata?: GoogleChatQuotedMessage
}

const ENGLISH_MONTHS = new Map([
  ['january', 0],
  ['february', 1],
  ['march', 2],
  ['april', 3],
  ['may', 4],
  ['june', 5],
  ['july', 6],
  ['august', 7],
  ['september', 8],
  ['october', 9],
  ['november', 10],
  ['december', 11],
])

export const feature: FormatFeature = {
  id: 'google-chat-takeout',
  name: 'Google Chat Takeout',
  platform: KNOWN_PLATFORMS.GOOGLE_CHAT,
  priority: 24,
  extensions: ['.json'],
  signatures: {
    head: [/"format"\s*:\s*"chatlab-google-chat-takeout"/],
    requiredFields: ['format', 'version', 'messagesFile'],
  },
}

function normalizeSpaces(value: string): string {
  return value
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function createUtcTimestamp(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
  second: number
): number | null {
  const timestampMs = Date.UTC(year, monthIndex, day, hour, minute, second)
  const date = new Date(timestampMs)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== monthIndex ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    return null
  }
  return Math.floor(timestampMs / 1000)
}

function parseChineseUtcDate(value: string): number | null {
  const match = normalizeSpaces(value).match(
    /^(\d{4})年(\d{1,2})月(\d{1,2})日(?:星期[一二三四五六日天])?\s+UTC\s+(\d{1,2}):(\d{2}):(\d{2})$/
  )
  if (!match) return null
  return createUtcTimestamp(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6])
  )
}

function parseEnglishUtcDate(value: string): number | null {
  const match = normalizeSpaces(value).match(
    /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)\s+UTC$/i
  )
  if (!match) return null

  const monthIndex = ENGLISH_MONTHS.get(match[1].toLowerCase())
  if (monthIndex === undefined) return null

  let hour = Number(match[4])
  if (hour < 1 || hour > 12) return null
  if (match[7].toUpperCase() === 'AM') {
    if (hour === 12) hour = 0
  } else if (hour !== 12) {
    hour += 12
  }

  return createUtcTimestamp(Number(match[3]), monthIndex, Number(match[2]), hour, Number(match[5]), Number(match[6]))
}

/**
 * Google Takeout 会根据导出语言生成本地化日期文本。这里只接受已验证的
 * 中文和英文 UTC 形式，避免宿主机 locale 或 Date.parse 产生不稳定结果。
 */
export function parseGoogleChatDate(value: string): number | null {
  return parseChineseUtcDate(value) ?? parseEnglishUtcDate(value)
}

function normalizeIdentity(user: GoogleChatUser | undefined): { platformId: string; name: string } {
  const email = user?.email?.trim().toLowerCase()
  const name = user?.name?.trim() || email || 'Unknown'
  return {
    platformId: email || name.toLowerCase(),
    name,
  }
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
}

function resolveManifestFile(manifestDir: string, relativePath: string): string {
  const resolved = path.resolve(manifestDir, relativePath)
  const relative = path.relative(manifestDir, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Google Chat manifest path escapes its directory: ${relativePath}`)
  }
  return resolved
}

function readManifest(filePath: string): {
  manifest: GoogleChatManifest
  userInfoPath: string
  groupInfoPath: string
  messagesPath: string
} {
  const manifest = readJson<GoogleChatManifest>(filePath)
  if (manifest.format !== 'chatlab-google-chat-takeout' || manifest.version !== 1) {
    throw new Error('Invalid Google Chat import manifest')
  }
  if (manifest.chatType !== 'private' && manifest.chatType !== 'group') {
    throw new Error('Invalid Google Chat chat type')
  }

  const manifestDir = path.dirname(filePath)
  return {
    manifest,
    userInfoPath: resolveManifestFile(manifestDir, manifest.userInfoFile),
    groupInfoPath: resolveManifestFile(manifestDir, manifest.groupInfoFile),
    messagesPath: resolveManifestFile(manifestDir, manifest.messagesFile),
  }
}

function getAttachmentName(attachment: GoogleChatAttachment): string | null {
  return attachment.original_name?.trim() || attachment.export_name?.trim() || null
}

function buildQuotePrefix(message: GoogleChatMessage): string | null {
  const quote = message.quoted_message_metadata
  const quoteText = quote?.text?.trim()
  if (!quoteText) return null
  const creator = quote?.creator?.name?.trim() || quote?.creator?.email?.trim()
  return creator ? `> ${creator}: ${quoteText}` : `> ${quoteText}`
}

function buildMessageContent(message: GoogleChatMessage): string {
  const parts: string[] = []
  const quote = buildQuotePrefix(message)
  if (quote) parts.push(quote)

  const text = message.text?.trim()
  if (text) parts.push(text)

  for (const attachment of message.attached_files ?? []) {
    const name = getAttachmentName(attachment)
    if (name) parts.push(`[附件] ${name}`)
  }

  return parts.length > 0 ? parts.join('\n') : '[不支持的 Google Chat 消息]'
}

function detectMessageType(message: GoogleChatMessage): MessageType {
  if (message.text?.trim()) return MessageType.TEXT
  if ((message.attached_files ?? []).some((attachment) => getAttachmentName(attachment))) {
    return MessageType.FILE
  }
  return MessageType.OTHER
}

function deriveChatName(
  manifest: GoogleChatManifest,
  groupInfo: GoogleChatGroupInfo,
  ownerId: string | undefined
): string {
  if (manifest.chatName?.trim()) return manifest.chatName.trim()
  if (manifest.chatType === 'group' && groupInfo.name?.trim()) return groupInfo.name.trim()

  const otherMember = (groupInfo.members ?? [])
    .map(normalizeIdentity)
    .find((member) => !ownerId || member.platformId !== ownerId)
  return (
    otherMember?.name ||
    groupInfo.members?.map((member) => normalizeIdentity(member).name).join(', ') ||
    manifest.chatId
  )
}

async function* parseGoogleChat(options: ParseOptions): AsyncGenerator<ParseEvent, void, unknown> {
  const { filePath, batchSize = 5000, onProgress, onLog } = options
  const { manifest, userInfoPath, groupInfoPath, messagesPath } = readManifest(filePath)
  const userInfo = readJson<GoogleChatUserInfo>(userInfoPath)
  const groupInfo = readJson<GoogleChatGroupInfo>(groupInfoPath)
  const owner = userInfo.user ? normalizeIdentity(userInfo.user) : null
  const totalBytes = getFileSize(messagesPath)

  const initialProgress = createProgress('parsing', 0, totalBytes, 0, '')
  yield { type: 'progress', data: initialProgress }
  onProgress?.(initialProgress)

  yield {
    type: 'meta',
    data: {
      name: deriveChatName(manifest, groupInfo, owner?.platformId),
      platform: KNOWN_PLATFORMS.GOOGLE_CHAT,
      type: manifest.chatType === 'group' ? ChatType.GROUP : ChatType.PRIVATE,
      ...(manifest.chatType === 'group' ? { groupId: manifest.chatId } : {}),
      ownerId: owner?.platformId,
    },
  }

  const memberMap = new Map<string, ParsedMember>()
  for (const member of groupInfo.members ?? []) {
    const identity = normalizeIdentity(member)
    memberMap.set(identity.platformId, {
      platformId: identity.platformId,
      accountName: identity.name,
    })
  }
  if (owner && !memberMap.has(owner.platformId)) {
    memberMap.set(owner.platformId, {
      platformId: owner.platformId,
      accountName: owner.name,
    })
  }
  yield { type: 'members', data: Array.from(memberMap.values()) }

  const readStream = fs.createReadStream(messagesPath, { encoding: 'utf8' })
  let bytesRead = 0
  let messagesProcessed = 0
  readStream.on('data', (chunk: string | Buffer) => {
    bytesRead += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
  })

  const pipeline = chain([readStream, parser(), pick({ filter: /^messages\.\d+$/ }), streamValues()])
  const messageBatch: ParsedMessage[] = []

  try {
    for await (const item of pipeline as AsyncIterable<{ value: GoogleChatMessage }>) {
      const message = item.value
      const sender = normalizeIdentity(message.creator)
      messageBatch.push({
        platformMessageId: message.message_id ? String(message.message_id) : undefined,
        senderPlatformId: sender.platformId,
        senderAccountName: sender.name,
        timestamp: parseGoogleChatDate(message.created_date ?? message.updated_date ?? '') ?? Number.NaN,
        type: detectMessageType(message),
        content: buildMessageContent(message),
      })
      messagesProcessed++

      if (messageBatch.length >= batchSize) {
        yield { type: 'messages', data: messageBatch.splice(0) }
        const progress = createProgress('parsing', bytesRead, totalBytes, messagesProcessed, '')
        yield { type: 'progress', data: progress }
        onProgress?.(progress)
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    onLog?.('error', `Failed to parse Google Chat messages: ${message}`)
    yield { type: 'error', data: new Error(`Failed to parse Google Chat messages: ${message}`) }
    return
  }

  if (messageBatch.length > 0) {
    yield { type: 'messages', data: messageBatch }
  }

  const doneProgress = createProgress('done', totalBytes, totalBytes, messagesProcessed, '')
  yield { type: 'progress', data: doneProgress }
  onProgress?.(doneProgress)
  yield { type: 'done', data: { messageCount: messagesProcessed, memberCount: memberMap.size } }
}

export const parser_: Parser = {
  feature,
  parse: parseGoogleChat,
}

const module_: FormatModule = {
  feature,
  parser: parser_,
}

export default module_
