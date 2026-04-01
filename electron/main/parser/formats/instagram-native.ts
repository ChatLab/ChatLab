/**
 * Instagram 官方导出格式解析器
 * 适配：Instagram 账号数据下载功能导出的 JSON 文件
 *
 * 文件结构：
 * - participants: 参与者数组 [{ name: string }]
 * - messages: 消息数组（逆序，最新在前）
 * - title: 对话标题（群名或对方用户名）
 * - thread_path: 线程路径，如 "inbox/xxx_123456"
 * - joinable_mode: 仅群聊有，包含入群链接
 *
 * 特殊处理：
 * - 编码问题：Instagram 将 UTF-8 字节按 Latin-1 编码后存储，需要解码
 * - 消息逆序：需要反转为正序
 * - 无用户 ID：使用用户名作为 platformId
 */

import * as fs from 'fs'
import * as path from 'path'
import { KNOWN_PLATFORMS, ChatType, MessageType } from '../../../../src/types/base'
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

// ==================== 特征定义 ====================

export const feature: FormatFeature = {
  id: 'instagram-native',
  name: 'Instagram 官方导出',
  platform: KNOWN_PLATFORMS.INSTAGRAM,
  priority: 25,
  extensions: ['.json'],
  signatures: {
    // 使用 Instagram 特有的字段作为签名（在文件头部就能匹配）
    // is_geoblocked_for_viewer 是 Instagram 消息特有的字段
    requiredFields: ['participants', 'messages'],
    head: [/"is_geoblocked_for_viewer"\s*:/],
  },
}

// ==================== 类型定义 ====================

interface InstagramParticipant {
  name: string
}

interface InstagramPhoto {
  uri: string
  creation_timestamp?: number
}

interface InstagramVideo {
  uri: string
  creation_timestamp?: number
}

interface InstagramAudio {
  uri: string
  creation_timestamp?: number
}

interface InstagramShare {
  link?: string
  share_text?: string
  original_content_owner?: string
}

interface InstagramReaction {
  reaction: string
  actor: string
}

interface InstagramMessage {
  sender_name: string
  timestamp_ms: number
  content?: string
  photos?: InstagramPhoto[]
  videos?: InstagramVideo[]
  audio_files?: InstagramAudio[]
  share?: InstagramShare
  reactions?: InstagramReaction[]
  is_geoblocked_for_viewer?: boolean
  is_unsent_image_by_messenger_kid_parent?: boolean
}

interface InstagramData {
  participants: InstagramParticipant[]
  messages: InstagramMessage[]
  title: string
  is_still_participant?: boolean
  thread_path: string
  magic_words?: unknown[]
  joinable_mode?: {
    mode: number
    link: string
  }
}

// ==================== 辅助函数 ====================

/**
 * 解码 Instagram 特殊编码的文本
 * Instagram 将 UTF-8 字节按 Latin-1 编码后存储
 */
function decodeInstagramText(text: string): string {
  try {
    // 将每个字符的 charCode 收集为字节数组
    const bytes = new Uint8Array(text.length)
    for (let i = 0; i < text.length; i++) {
      bytes[i] = text.charCodeAt(i)
    }
    // 用 UTF-8 解码
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return text // 解码失败则返回原文
  }
}

/**
 * 从文件名提取名称（备用）
 */
function extractNameFromFilePath(filePath: string): string {
  const basename = path.basename(filePath)
  return basename.replace(/\.json$/i, '') || '未知对话'
}

/**
 * 判断是否为系统消息
 */
function isSystemMessage(content: string): boolean {
  const systemPatterns = [
    'You created the group',
    'created the group',
    'added',
    'to the group',
    'left the group',
    'removed',
    'named the group',
    'changed the group photo',
    'Reacted',
    'sent an attachment',
    'liked a message',
    'changed the theme',
    'set the nickname',
  ]
  return systemPatterns.some((p) => content.includes(p))
}

/**
 * 判断消息类型
 */
function detectMessageType(msg: InstagramMessage): MessageType {
  const content = msg.content || ''

  // 1. 系统消息判断
  if (content && isSystemMessage(content)) {
    return MessageType.SYSTEM
  }

  // 2. 媒体消息
  if (msg.photos?.length) return MessageType.IMAGE
  if (msg.videos?.length) return MessageType.VIDEO
  if (msg.audio_files?.length) return MessageType.VOICE

  // 3. 分享消息
  if (msg.share) {
    const link = msg.share.link || ''
    if (link.includes('giphy.com')) return MessageType.EMOJI
    return MessageType.LINK
  }

  // 4. 文本消息
  if (content) return MessageType.TEXT

  // 5. 空消息（位置分享、通话等已删除的消息）
  return MessageType.OTHER
}

/**
 * 获取消息内容
 */
function getMessageContent(msg: InstagramMessage): string | null {
  // 文本内容
  if (msg.content) {
    return decodeInstagramText(msg.content)
  }

  // 图片
  if (msg.photos?.length) {
    return `[图片] ${msg.photos[0].uri}`
  }

  // 视频
  if (msg.videos?.length) {
    return `[视频] ${msg.videos[0].uri}`
  }

  // 语音
  if (msg.audio_files?.length) {
    return `[语音] ${msg.audio_files[0].uri}`
  }

  // 分享
  if (msg.share) {
    const link = msg.share.link || ''
    if (link.includes('giphy.com')) {
      return `[GIF] ${link}`
    }
    return `[链接] ${link}`
  }

  // 空消息
  return '[未知消息]'
}

// ==================== 解析器实现 ====================

async function* parseInstagram(options: ParseOptions): AsyncGenerator<ParseEvent, void, unknown> {
  const { filePath, batchSize = 5000, onProgress, onLog } = options

  const totalBytes = getFileSize(filePath)
  let messagesProcessed = 0

  // 发送初始进度
  const initialProgress = createProgress('parsing', 0, totalBytes, 0, '正在解析 Instagram 聊天记录...')
  yield { type: 'progress', data: initialProgress }
  onProgress?.(initialProgress)

  onLog?.('info', `开始解析 Instagram 聊天记录，大小: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`)

  // 读取并解析 JSON 文件
  let data: InstagramData
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    data = JSON.parse(content)
  } catch (error) {
    const err = new Error(`无法解析 Instagram JSON 文件: ${error}`)
    yield { type: 'error', data: err }
    return
  }

  // 判断聊天类型
  const isGroup = data.participants.length > 2 || !!data.joinable_mode
  const chatType = isGroup ? ChatType.GROUP : ChatType.PRIVATE

  // 判断 Owner
  let ownerId: string | undefined
  if (chatType === ChatType.PRIVATE) {
    // 私聊：title 是对方名字，另一个参与者是 owner
    const owner = data.participants.find((p) => decodeInstagramText(p.name) !== decodeInstagramText(data.title))
    ownerId = owner ? decodeInstagramText(owner.name) : undefined
  } else {
    // 群聊：找 "You created the group." 消息的发送者
    const createMsg = data.messages.find((m) => m.content === 'You created the group.')
    ownerId = createMsg ? decodeInstagramText(createMsg.sender_name) : undefined
  }

  // 发送 meta
  const meta: ParsedMeta = {
    name: decodeInstagramText(data.title) || extractNameFromFilePath(filePath),
    platform: KNOWN_PLATFORMS.INSTAGRAM,
    type: chatType,
    ownerId,
  }
  yield { type: 'meta', data: meta }

  // 收集成员信息
  const memberMap = new Map<string, ParsedMember>()
  for (const participant of data.participants) {
    const name = decodeInstagramText(participant.name)
    memberMap.set(name, {
      platformId: name,
      accountName: name,
    })
  }

  // 发送成员
  const members = Array.from(memberMap.values())
  yield { type: 'members', data: members }

  // 处理消息（Instagram 消息是逆序的，需要反转）
  const reversedMessages = [...data.messages].reverse()
  const messageBatch: ParsedMessage[] = []

  for (const msg of reversedMessages) {
    const senderName = decodeInstagramText(msg.sender_name)
    const timestamp = Math.floor(msg.timestamp_ms / 1000) // 毫秒转秒
    const type = detectMessageType(msg)
    const content = getMessageContent(msg)

    // 确保成员存在（处理消息中出现但不在 participants 中的情况）
    if (!memberMap.has(senderName)) {
      memberMap.set(senderName, {
        platformId: senderName,
        accountName: senderName,
      })
    }

    messageBatch.push({
      senderPlatformId: senderName,
      senderAccountName: senderName,
      timestamp,
      type,
      content,
    })

    messagesProcessed++

    // 分批输出消息
    if (messageBatch.length >= batchSize) {
      yield { type: 'messages', data: [...messageBatch] }
      messageBatch.length = 0

      const progress = createProgress(
        'parsing',
        Math.floor((messagesProcessed / reversedMessages.length) * totalBytes),
        totalBytes,
        messagesProcessed,
        `已处理 ${messagesProcessed} 条消息...`
      )
      onProgress?.(progress)
    }
  }

  // 发送剩余消息
  if (messageBatch.length > 0) {
    yield { type: 'messages', data: messageBatch }
  }

  // 完成
  const doneProgress = createProgress('done', totalBytes, totalBytes, messagesProcessed, '解析完成')
  yield { type: 'progress', data: doneProgress }
  onProgress?.(doneProgress)

  onLog?.('info', `解析完成: ${messagesProcessed} 条消息, ${memberMap.size} 个成员`)

  yield {
    type: 'done',
    data: { messageCount: messagesProcessed, memberCount: memberMap.size },
  }
}

// ==================== 导出 ====================

export const parser_: Parser = {
  feature,
  parse: parseInstagram,
}

const module_: FormatModule = {
  feature,
  parser: parser_,
}

export default module_
