/**
 * Telegram 单聊天导出 JSON 格式解析器
 * 适配 Telegram Desktop (Windows) 的「导出聊天记录」→ 单个聊天导出
 *
 * 格式特征：
 * - 单个 JSON 文件只包含一个聊天
 * - 顶层直接是聊天对象：{ name, type, id, messages }
 * - 没有 about / personal_information / chats 等外层包装
 * - 消息结构与全量导出一致（date_unixtime, from_id, text_entities 等）
 * - 支持 personal_chat / bot_chat / private_group / public_channel 等类型
 *
 * 导入流程（直接导入，无需聊天选择器）：
 * 1. 用户选择单聊天 JSON 文件 → 格式识别
 * 2. parser 直接读取并解析该文件
 */

import * as fs from 'fs'
import { chain } from 'stream-chain'
import { parser } from 'stream-json'
import { streamValues } from 'stream-json/streamers/StreamValues'

import { KNOWN_PLATFORMS, ChatType } from '../../../../src/types/base'
import type {
  FormatFeature,
  FormatModule,
  Parser,
  ParseOptions,
  ParseEvent,
  ParsedMeta,
  ParsedMember,
  ParsedMessage,
} from '../types'
import { getFileSize, createProgress } from '../utils'
import { mapChatType, extractPlatformId, detectMessageType, buildContent } from './utils/telegram-utils'
import type { TelegramChat } from './utils/telegram-utils'

// ==================== 特征定义 ====================

export const feature: FormatFeature = {
  id: 'telegram-native-single',
  name: 'Telegram 单聊天导出 (JSON)',
  platform: KNOWN_PLATFORMS.TELEGRAM,
  priority: 23,
  extensions: ['.json'],
  signatures: {
    // Telegram 单聊天导出特征：文件以 "name" 作为第一个 JSON 键
    // 这与全量导出（以 "about" 开头）有效区分，避免嵌套字段误匹配
    head: [/^\s*\{\s*\r?\n\s*"name"\s*:/],
    requiredFields: ['messages'],
    fieldPatterns: {
      // Telegram 特有的聊天类型值，精确区分
      telegramChatType:
        /"type"\s*:\s*"(personal_chat|bot_chat|private_group|private_supergroup|public_group|public_supergroup|public_channel|private_channel|saved_messages)"/,
    },
  },
}

// ==================== 解析器实现 ====================

async function* parseTelegramSingle(options: ParseOptions): AsyncGenerator<ParseEvent, void, unknown> {
  const { filePath, batchSize = 5000, onProgress, onLog } = options

  const totalBytes = getFileSize(filePath)
  let messagesProcessed = 0

  // 发送初始进度
  const initialProgress = createProgress('parsing', 0, totalBytes, 0, '')
  yield { type: 'progress', data: initialProgress }
  onProgress?.(initialProgress)

  onLog?.('info', `开始解析 Telegram 单聊天 JSON 文件，大小: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`)

  // 流式读取整个文件（顶层即为聊天对象）
  const chatData = await new Promise<TelegramChat | null>((resolve, reject) => {
    const readStream = fs.createReadStream(filePath, { encoding: 'utf-8' })

    const pipeline = chain([readStream, parser(), streamValues()])

    let found = false

    pipeline.on('data', ({ value }: { value: TelegramChat }) => {
      if (!found) {
        found = true
        resolve(value)
      }
    })

    pipeline.on('end', () => {
      if (!found) resolve(null)
    })

    pipeline.on('error', reject)
  })

  if (!chatData) {
    onLog?.('error', '无法解析 Telegram 单聊天文件')
    yield { type: 'error', data: new Error('无法解析 Telegram 单聊天文件') }
    return
  }

  onLog?.('info', `聊天: "${chatData.name}", 类型: ${chatData.type}, 消息数: ${chatData.messages?.length || 0}`)

  // 确定聊天类型
  const chatType = mapChatType(chatData.type)

  // 发送 meta
  const meta: ParsedMeta = {
    name: chatData.name || `Telegram Chat ${chatData.id}`,
    platform: KNOWN_PLATFORMS.TELEGRAM,
    type: chatType,
    groupId: chatType === ChatType.GROUP ? String(chatData.id) : undefined,
  }
  yield { type: 'meta', data: meta }

  // 收集成员和消息
  const memberMap = new Map<string, ParsedMember>()
  const messageBatch: ParsedMessage[] = []
  const messages = chatData.messages || []

  for (const msg of messages) {
    // 提取发送者信息
    let senderPlatformId: string
    let senderName: string

    if (msg.type === 'service') {
      // Service 消息使用 actor 信息
      senderPlatformId = extractPlatformId(msg.actor_id)
      senderName = msg.actor || '系统'
    } else {
      senderPlatformId = extractPlatformId(msg.from_id)
      senderName = msg.from || senderPlatformId
    }

    // 更新成员
    if (!memberMap.has(senderPlatformId) && senderPlatformId !== 'unknown') {
      memberMap.set(senderPlatformId, {
        platformId: senderPlatformId,
        accountName: senderName,
      })
    }

    // 解析时间戳
    const timestamp = parseInt(msg.date_unixtime, 10)
    if (isNaN(timestamp)) continue

    // 构建消息
    const parsedMsg: ParsedMessage = {
      platformMessageId: String(msg.id),
      senderPlatformId,
      senderAccountName: senderName,
      timestamp,
      type: detectMessageType(msg),
      content: buildContent(msg),
      replyToMessageId: msg.reply_to_message_id ? String(msg.reply_to_message_id) : undefined,
    }

    messageBatch.push(parsedMsg)
    messagesProcessed++

    // 分批 yield 消息
    if (messageBatch.length >= batchSize) {
      yield { type: 'messages', data: [...messageBatch] }
      messageBatch.length = 0

      const progress = createProgress(
        'parsing',
        0,
        totalBytes,
        messagesProcessed,
        `已处理 ${messagesProcessed} 条消息...`
      )
      yield { type: 'progress', data: progress }
      onProgress?.(progress)
    }
  }

  // 发送成员
  yield { type: 'members', data: Array.from(memberMap.values()) }

  // 发送剩余消息
  if (messageBatch.length > 0) {
    yield { type: 'messages', data: messageBatch }
  }

  // 完成
  const doneProgress = createProgress('done', totalBytes, totalBytes, messagesProcessed, '')
  yield { type: 'progress', data: doneProgress }
  onProgress?.(doneProgress)

  onLog?.('info', `解析完成: ${messagesProcessed} 条消息, ${memberMap.size} 个成员, 类型: ${chatType}`)

  yield {
    type: 'done',
    data: { messageCount: messagesProcessed, memberCount: memberMap.size },
  }
}

// ==================== 导出 ====================

export const parser_: Parser = {
  feature,
  parse: parseTelegramSingle,
}

const module_: FormatModule = {
  feature,
  parser: parser_,
}

export default module_
