import * as fs from 'fs'
import Assembler from 'stream-json/Assembler.js'
import streamJson from 'stream-json'
import { ChatType, KNOWN_PLATFORMS } from '@openchatlab/shared-types'

import { TELEGRAM_SINGLE_CHAT_TYPE_PATTERN, TELEGRAM_SINGLE_HEAD_SIGNATURES } from '../browser/telegram'
import type {
  FormatFeature,
  FormatModule,
  ParsedMember,
  ParsedMessage,
  ParsedMeta,
  ParseEvent,
  ParseOptions,
  Parser,
} from '../types'
import { createProgress, getFileSize } from '../utils'
import { buildContent, detectMessageType, extractPlatformId, mapChatType } from './utils/telegram-utils'
import type { TelegramMessage } from './utils/telegram-utils'

const { parser } = streamJson

interface JsonToken {
  name: string
  value?: string
}

export const feature: FormatFeature = {
  id: 'telegram-native-single',
  name: 'Telegram 单聊天导出 (JSON)',
  platform: KNOWN_PLATFORMS.TELEGRAM,
  priority: 23,
  extensions: ['.json'],
  signatures: {
    head: TELEGRAM_SINGLE_HEAD_SIGNATURES,
    requiredFields: ['messages'],
    fieldPatterns: { telegramChatType: TELEGRAM_SINGLE_CHAT_TYPE_PATTERN },
  },
}

async function* parseTelegramSingle(options: ParseOptions): AsyncGenerator<ParseEvent, void, unknown> {
  const { filePath, batchSize = 5000, onProgress, onLog } = options
  const totalBytes = getFileSize(filePath)
  const initialProgress = createProgress('parsing', 0, totalBytes, 0, '')
  yield { type: 'progress', data: initialProgress }
  onProgress?.(initialProgress)
  onLog?.('info', `Starting Telegram single-chat JSON parsing (${(totalBytes / 1024 / 1024).toFixed(2)} MB)`)

  let messagesProcessed = 0
  const memberMap = new Map<string, ParsedMember>()
  const messageBatch: ParsedMessage[] = []

  try {
    const readStream = fs.createReadStream(filePath, { encoding: 'utf-8' })
    const tokenStream = readStream.pipe(parser())
    let depth = 0
    let rootKey: string | null = null
    let chatName: string | null = null
    let telegramType: string | null = null
    let chatId: number | null = null
    let messagesArrayDepth: number | null = null
    let messageAssembler: Assembler | null = null
    let meta: ParsedMeta | null = null

    for await (const rawToken of tokenStream) {
      const token = rawToken as JsonToken

      // Assembler 只组装 messages 数组中的单条消息，避免重新构造完整 JSON 根对象。
      if (messageAssembler) {
        messageAssembler.consume(token)
        if (messageAssembler.done) {
          const message = messageAssembler.current as TelegramMessage
          messageAssembler = null
          const parsedMessage = parseTelegramMessage(message, memberMap)
          if (parsedMessage) {
            messageBatch.push(parsedMessage)
            messagesProcessed++
          }

          if (messageBatch.length >= batchSize) {
            yield { type: 'messages', data: messageBatch.splice(0) }
            const progress = createProgress(
              'parsing',
              readStream.bytesRead,
              totalBytes,
              messagesProcessed,
              `Processed ${messagesProcessed} messages`
            )
            yield { type: 'progress', data: progress }
            onProgress?.(progress)
          }
        }
      } else if (token.name === 'keyValue' && depth === 1) {
        rootKey = token.value ?? null
      } else if (token.name === 'stringValue' && depth === 1) {
        if (rootKey === 'name') chatName = token.value ?? ''
        if (rootKey === 'type') telegramType = token.value ?? ''
      } else if (token.name === 'numberValue' && depth === 1 && rootKey === 'id') {
        const parsedId = Number(token.value)
        if (Number.isFinite(parsedId)) chatId = parsedId
      }

      if (token.name === 'startArray' && depth === 1 && rootKey === 'messages') {
        // Telegram 官方导出的元信息位于 messages 之前，可先输出 meta，再持续输出消息批次。
        if (chatName === null || telegramType === null || chatId === null) {
          throw new Error('Invalid Telegram single-chat JSON export')
        }
        const chatType = mapChatType(telegramType)
        meta = {
          name: chatName || `Telegram Chat ${chatId}`,
          platform: KNOWN_PLATFORMS.TELEGRAM,
          type: chatType,
          groupId: chatType === ChatType.GROUP ? String(chatId) : undefined,
        }
        messagesArrayDepth = depth + 1
        yield { type: 'meta', data: meta }
      } else if (token.name === 'startObject' && messagesArrayDepth !== null && depth === messagesArrayDepth) {
        messageAssembler = new Assembler()
        messageAssembler.consume(token)
      }

      // 无论 token 是否已被 Assembler 消费，都必须同步外层深度，确保下一条消息仍从数组层级开始。
      if (token.name === 'startObject' || token.name === 'startArray') {
        depth++
      } else if (token.name === 'endObject' || token.name === 'endArray') {
        depth--
      }
    }

    if (!meta || messagesArrayDepth === null || messageAssembler) {
      throw new Error('Invalid Telegram single-chat JSON export')
    }
  } catch (error) {
    const parseError = error instanceof Error ? error : new Error(String(error))
    onLog?.('error', 'Telegram single-chat JSON parsing failed')
    yield { type: 'error', data: parseError }
    return
  }

  yield { type: 'members', data: Array.from(memberMap.values()) }
  if (messageBatch.length > 0) {
    yield { type: 'messages', data: messageBatch }
  }

  const doneProgress = createProgress('done', totalBytes, totalBytes, messagesProcessed, '')
  yield { type: 'progress', data: doneProgress }
  onProgress?.(doneProgress)
  onLog?.(
    'info',
    `Telegram single-chat JSON parsing completed: ${messagesProcessed} messages, ${memberMap.size} members`
  )
  yield {
    type: 'done',
    data: { messageCount: messagesProcessed, memberCount: memberMap.size },
  }
}

function parseTelegramMessage(message: TelegramMessage, memberMap: Map<string, ParsedMember>): ParsedMessage | null {
  const isService = message.type === 'service'
  const senderPlatformId = extractPlatformId(isService ? message.actor_id : message.from_id)
  const senderName = isService ? message.actor || 'System' : message.from || senderPlatformId

  if (!memberMap.has(senderPlatformId) && senderPlatformId !== 'unknown') {
    memberMap.set(senderPlatformId, {
      platformId: senderPlatformId,
      accountName: senderName,
    })
  }

  const timestamp = Number.parseInt(message.date_unixtime, 10)
  if (Number.isNaN(timestamp)) return null

  return {
    platformMessageId: String(message.id),
    senderPlatformId,
    senderAccountName: senderName,
    timestamp,
    type: detectMessageType(message),
    content: buildContent(message),
    replyToMessageId: message.reply_to_message_id ? String(message.reply_to_message_id) : undefined,
  }
}

export const parser_: Parser = { feature, parse: parseTelegramSingle }

const module_: FormatModule = { feature, parser: parser_ }

export default module_
