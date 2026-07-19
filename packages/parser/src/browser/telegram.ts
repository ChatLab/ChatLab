import { ChatType, KNOWN_PLATFORMS } from '@openchatlab/shared-types'
import type { ParsedMember, ParsedMessage } from '@openchatlab/shared-types'

import type { ParsedMeta } from '../types'
import { buildContent, detectMessageType, extractPlatformId, mapChatType } from '../formats/utils/telegram-utils'
import type { TelegramChat, TelegramMessage } from '../formats/utils/telegram-utils'

export const TELEGRAM_SINGLE_CHAT_TYPE_PATTERN =
  /"type"\s*:\s*"(personal_chat|bot_chat|private_group|private_supergroup|public_group|public_supergroup|public_channel|private_channel|saved_messages)"/
export const TELEGRAM_SINGLE_HEAD_SIGNATURES = [/^\s*\{\s*(?:\r?\n\s*)?"name"\s*:/]
export const TELEGRAM_MULTI_CHAT_HEAD_SIGNATURES = [/^\s*\{\s*(?:\r?\n\s*)?"about"\s*:/, /Telegram/i]
const TELEGRAM_MESSAGES_PATTERN = /"messages"\s*:/

export interface TelegramJsonParseOptions {
  checkCancelled?: () => void
  onProgress?: (progress: { progress: number; messagesProcessed: number }) => void
  yieldEvery?: number
}

export type TelegramSingleJsonParseOptions = TelegramJsonParseOptions

export interface TelegramJsonParseResult {
  meta: ParsedMeta
  members: ParsedMember[]
  messages: ParsedMessage[]
}

export type TelegramSingleJsonParseResult = TelegramJsonParseResult

export interface TelegramChatInfo {
  index: number
  name: string
  type: string
  id: number
  messageCount: number
}

interface TelegramFullExport {
  about: string
  chats: { list: TelegramChat[] }
}

export function detectTelegramSingleJson(head: string, fileName: string): boolean {
  const basename = getBasename(fileName)
  return (
    basename.toLowerCase().endsWith('.json') &&
    TELEGRAM_SINGLE_HEAD_SIGNATURES.some((signature) => signature.test(head)) &&
    TELEGRAM_SINGLE_CHAT_TYPE_PATTERN.test(head) &&
    TELEGRAM_MESSAGES_PATTERN.test(head)
  )
}

export function detectTelegramMultiChatJson(head: string, fileName: string): boolean {
  const basename = getBasename(fileName)
  return (
    basename.toLowerCase().endsWith('.json') &&
    TELEGRAM_MULTI_CHAT_HEAD_SIGNATURES.every((signature) => signature.test(head))
  )
}

export async function scanTelegramChatsJson(
  content: string,
  options: Pick<TelegramJsonParseOptions, 'checkCancelled' | 'yieldEvery'> = {}
): Promise<TelegramChatInfo[]> {
  options.checkCancelled?.()
  const value = parseTelegramFullExport(content)
  const chats: TelegramChatInfo[] = []
  const yieldEvery = Math.max(1, options.yieldEvery ?? 100)

  for (let index = 0; index < value.chats.list.length; index += 1) {
    options.checkCancelled?.()
    const chat = value.chats.list[index]
    chats.push({
      index,
      name: chat.name || `Chat ${chat.id}`,
      type: chat.type,
      id: chat.id,
      messageCount: chat.messages.length,
    })
    if (index > 0 && index % yieldEvery === 0) {
      await yieldToEventLoop()
      options.checkCancelled?.()
    }
  }

  options.checkCancelled?.()
  return chats
}

export async function parseTelegramMultiChatJson(
  content: string,
  chatIndex: number,
  options: TelegramJsonParseOptions = {}
): Promise<TelegramJsonParseResult> {
  options.checkCancelled?.()
  const value = parseTelegramFullExport(content)
  if (!Number.isInteger(chatIndex) || chatIndex < 0 || chatIndex >= value.chats.list.length) {
    throw new Error(`Invalid Telegram chat index: ${chatIndex}`)
  }
  return parseTelegramChat(value.chats.list[chatIndex], options)
}

export async function parseTelegramSingleJson(
  content: string,
  options: TelegramSingleJsonParseOptions = {}
): Promise<TelegramSingleJsonParseResult> {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch (error) {
    throw new Error('Invalid Telegram single-chat JSON export', { cause: error })
  }
  if (!isTelegramChat(value)) {
    throw new Error('Invalid Telegram single-chat JSON export')
  }

  return parseTelegramChat(value, options)
}

async function parseTelegramChat(
  value: TelegramChat,
  options: TelegramJsonParseOptions
): Promise<TelegramJsonParseResult> {
  const memberMap = new Map<string, ParsedMember>()
  const messages: ParsedMessage[] = []
  const chatType = mapChatType(value.type)
  const yieldEvery = Math.max(1, options.yieldEvery ?? 1000)

  for (let index = 0; index < value.messages.length; index += 1) {
    options.checkCancelled?.()
    const message = value.messages[index]
    const { senderPlatformId, senderName } = resolveSender(message)
    if (!memberMap.has(senderPlatformId) && senderPlatformId !== 'unknown') {
      memberMap.set(senderPlatformId, {
        platformId: senderPlatformId,
        accountName: senderName,
      })
    }

    const timestamp = Number.parseInt(message.date_unixtime, 10)
    if (!Number.isNaN(timestamp)) {
      messages.push({
        platformMessageId: String(message.id),
        senderPlatformId,
        senderAccountName: senderName,
        timestamp,
        type: detectMessageType(message),
        content: buildContent(message),
        replyToMessageId: message.reply_to_message_id ? String(message.reply_to_message_id) : undefined,
      })
    }

    if (index > 0 && index % yieldEvery === 0) {
      options.onProgress?.({ progress: index / value.messages.length, messagesProcessed: messages.length })
      await yieldToEventLoop()
      options.checkCancelled?.()
    }
  }

  options.checkCancelled?.()
  const result: TelegramSingleJsonParseResult = {
    meta: {
      name: value.name || `Telegram Chat ${value.id}`,
      platform: KNOWN_PLATFORMS.TELEGRAM,
      type: chatType,
      groupId: chatType === ChatType.GROUP ? String(value.id) : undefined,
    },
    members: Array.from(memberMap.values()),
    messages,
  }
  options.onProgress?.({ progress: 1, messagesProcessed: messages.length })
  return result
}

function parseTelegramFullExport(content: string): TelegramFullExport {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch (error) {
    throw new Error('Invalid Telegram full export JSON', { cause: error })
  }
  if (!isTelegramFullExport(value)) throw new Error('Invalid Telegram full export JSON')
  return value
}

function isTelegramFullExport(value: unknown): value is TelegramFullExport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as { about?: unknown; chats?: { list?: unknown } }
  return (
    typeof candidate.about === 'string' &&
    /Telegram/i.test(candidate.about) &&
    Array.isArray(candidate.chats?.list) &&
    candidate.chats.list.every(isTelegramChat)
  )
}

function isTelegramChat(value: unknown): value is TelegramChat {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<TelegramChat>
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.type === 'string' &&
    typeof candidate.id === 'number' &&
    Number.isFinite(candidate.id) &&
    Array.isArray(candidate.messages)
  )
}

function resolveSender(message: TelegramMessage): { senderPlatformId: string; senderName: string } {
  if (message.type === 'service') {
    const senderPlatformId = extractPlatformId(message.actor_id)
    return { senderPlatformId, senderName: message.actor || 'System' }
  }
  const senderPlatformId = extractPlatformId(message.from_id)
  return { senderPlatformId, senderName: message.from || senderPlatformId }
}

function getBasename(fileName: string): string {
  return fileName.split(/[\\/]/).pop() ?? fileName
}

function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}
