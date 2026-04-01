/**
 * ChatLab JSONL 格式
 * 支持超大规模聊天记录的流式格式
 *
 * 格式特点：
 * - 每行一个 JSON 对象
 * - 第一行必须是 header（包含 chatlab 和 meta）
 * - 成员行（可选）在消息行之前
 * - 消息行按时间顺序排列
 * - 通过 _type 字段区分行类型：header / member / message
 *
 * 优势：
 * - 内存占用恒定，支持 GB 级文件
 * - 可逐行处理，支持流式导入
 * - 便于追加写入
 */

import * as fs from 'fs'
import * as readline from 'readline'
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

// ==================== JSONL 行类型定义 ====================

/** Header 行结构 */
interface JsonlHeader {
  _type: 'header'
  chatlab: {
    version: string
    exportedAt: number
    generator?: string
    description?: string
  }
  meta: {
    name: string
    platform: string
    type: string
    groupId?: string
    groupAvatar?: string
  }
}

/** Member 行结构 */
interface JsonlMember {
  _type: 'member'
  platformId: string
  accountName: string
  groupNickname?: string
  aliases?: string[]
  avatar?: string
}

/** Message 行结构 */
interface JsonlMessage {
  _type: 'message'
  sender: string
  platformMessageId?: string
  accountName: string
  groupNickname?: string
  timestamp: number
  type: number
  content: string | null
  replyToMessageId?: string
}

/** 任意 JSONL 行 */
type JsonlLine = JsonlHeader | JsonlMember | JsonlMessage

// ==================== 辅助函数 ====================

/**
 * 从文件名提取群名
 */
function extractNameFromFilePath(filePath: string): string {
  const basename = path.basename(filePath)
  const name = basename.replace(/\.jsonl$/i, '')
  return name || '未知群聊'
}

/**
 * 解析单行 JSONL
 */
function parseLine(line: string): JsonlLine | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) {
    // 空行或注释行，跳过
    return null
  }
  try {
    return JSON.parse(trimmed) as JsonlLine
  } catch {
    // 解析失败，跳过该行
    return null
  }
}

// ==================== 特征定义 ====================

export const feature: FormatFeature = {
  id: 'chatlab-jsonl',
  name: 'ChatLab JSONL',
  platform: KNOWN_PLATFORMS.UNKNOWN,
  priority: 51, // 低优先级，让其他格式先匹配
  extensions: ['.jsonl'],
  signatures: {
    // 第一行必须是 header 类型，包含 chatlab 信息
    head: [/^\s*\{.*"_type"\s*:\s*"header".*"chatlab"/],
  },
}

// ==================== 解析器实现 ====================

async function* parseChatLabJsonl(options: ParseOptions): AsyncGenerator<ParseEvent, void, unknown> {
  const { filePath, batchSize = 5000, onProgress, onLog } = options

  const totalBytes = getFileSize(filePath)
  let bytesRead = 0
  let messagesProcessed = 0

  // 发送初始进度
  const initialProgress = createProgress('parsing', 0, totalBytes, 0, '')
  yield { type: 'progress', data: initialProgress }
  onProgress?.(initialProgress)

  // 记录解析开始
  onLog?.('info', `开始解析 ChatLab JSONL 文件，大小: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`)

  // 用于收集成员和消息
  const members: ParsedMember[] = []
  const memberMap = new Map<string, ParsedMember>()
  const messageBatch: ParsedMessage[] = []
  let meta: ParsedMeta | null = null
  let headerParsed = false

  // 创建逐行读取流
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' })
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  })

  // 跟踪已读取字节数
  fileStream.on('data', (chunk: string | Buffer) => {
    bytesRead += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
  })

  // 逐行解析
  for await (const line of rl) {
    const parsed = parseLine(line)
    if (!parsed) continue

    switch (parsed._type) {
      case 'header':
        if (!headerParsed) {
          meta = {
            name: parsed.meta.name || extractNameFromFilePath(filePath),
            platform: parsed.meta.platform || KNOWN_PLATFORMS.UNKNOWN,
            type: (parsed.meta.type as ChatType) || ChatType.GROUP,
            groupId: parsed.meta.groupId,
            groupAvatar: parsed.meta.groupAvatar,
          }
          headerParsed = true
          yield { type: 'meta', data: meta }
        }
        break

      case 'member':
        {
          const member: ParsedMember = {
            platformId: parsed.platformId,
            accountName: parsed.accountName,
            groupNickname: parsed.groupNickname,
            avatar: parsed.avatar,
          }
          members.push(member)
          memberMap.set(parsed.platformId, member)
        }
        break

      case 'message':
        // 如果还没有 header，尝试从文件名推断
        if (!meta) {
          meta = {
            name: extractNameFromFilePath(filePath),
            platform: KNOWN_PLATFORMS.UNKNOWN,
            type: ChatType.GROUP,
          }
          yield { type: 'meta', data: meta }
        }

        // 如果没有成员列表，从消息中收集
        if (!memberMap.has(parsed.sender)) {
          const inferredMember: ParsedMember = {
            platformId: parsed.sender,
            accountName: parsed.accountName,
            groupNickname: parsed.groupNickname,
          }
          memberMap.set(parsed.sender, inferredMember)
        }

        messageBatch.push({
          senderPlatformId: parsed.sender,
          senderAccountName: parsed.accountName,
          senderGroupNickname: parsed.groupNickname,
          timestamp: parsed.timestamp,
          type: parsed.type as MessageType,
          content: parsed.content,
          platformMessageId: parsed.platformMessageId,
          replyToMessageId: parsed.replyToMessageId,
        })
        messagesProcessed++

        // 达到批次大小，发送进度
        if (messageBatch.length >= batchSize) {
          const progress = createProgress(
            'parsing',
            bytesRead,
            totalBytes,
            messagesProcessed,
            `已处理 ${messagesProcessed.toLocaleString()} 条消息...`
          )
          onProgress?.(progress)
        }
        break
    }
  }

  // 如果没有解析到 header，使用默认值
  if (!meta) {
    meta = {
      name: extractNameFromFilePath(filePath),
      platform: KNOWN_PLATFORMS.UNKNOWN,
      type: ChatType.GROUP,
    }
    yield { type: 'meta', data: meta }
  }

  // 发送成员
  if (members.length > 0) {
    yield { type: 'members', data: members }
  } else if (memberMap.size > 0) {
    yield { type: 'members', data: Array.from(memberMap.values()) }
  }

  // 分批发送消息
  for (let i = 0; i < messageBatch.length; i += batchSize) {
    const batch = messageBatch.slice(i, i + batchSize)
    yield { type: 'messages', data: batch }
  }

  // 完成
  const doneProgress = createProgress('done', totalBytes, totalBytes, messagesProcessed, '')
  yield { type: 'progress', data: doneProgress }
  onProgress?.(doneProgress)

  // 记录解析摘要
  const memberCount = members.length > 0 ? members.length : memberMap.size
  onLog?.('info', `解析完成: ${messagesProcessed} 条消息, ${memberCount} 个成员`)

  yield {
    type: 'done',
    data: {
      messageCount: messagesProcessed,
      memberCount,
    },
  }
}

// ==================== 导出解析器 ====================

export const parser: Parser = {
  feature,
  parse: parseChatLabJsonl,
}

// ==================== 导出格式模块 ====================

const module_: FormatModule = {
  feature,
  parser,
}

export default module_
