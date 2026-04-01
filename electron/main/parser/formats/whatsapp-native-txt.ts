/**
 * WhatsApp 官方导出 TXT 格式解析器
 * 适配 WhatsApp 聊天导出功能
 *
 * 格式特征：
 * - 文件头：消息和通话已进行端到端加密 / Messages and calls are end-to-end encrypted
 * - 消息格式（V1，无方括号）：YYYY/MM/DD HH:MM - 昵称: 内容
 * - 消息格式（V2，方括号）：
 *   - [M/D/YY HH:MM:SS] 昵称: 内容（2 位年份）
 *   - [YYYY/MM/DD HH:MM:SS] 昵称: 内容（4 位年份在前，中文地区）
 *   - [DD/MM/YYYY, HH:MM:SS] 昵称: 内容（4 位年份在后，英文地区）
 * - 系统消息：时间戳 + 系统内容（无冒号分隔）
 * - 媒体占位：<省略影音内容>
 */

import * as fs from 'fs'
import * as path from 'path'
import * as readline from 'readline'
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

// ==================== 辅助函数 ====================

/**
 * 从文件名提取聊天名称
 * 例如：与开心每一天的 WhatsApp 聊天.txt → 开心每一天
 * 例如：与gaoberry37的 WhatsApp 聊天.txt → gaoberry37
 */
function extractNameFromFilePath(filePath: string): string {
  const basename = path.basename(filePath)
  // 匹配：与xxx的 WhatsApp 聊天.txt
  const match = basename.match(/^与(.+?)的\s*WhatsApp\s*聊天\.txt$/i)
  if (match) {
    return match[1].trim()
  }
  // 兜底：移除扩展名
  return basename.replace(/\.txt$/i, '') || '未知聊天'
}

// ==================== 特征定义 ====================

export const feature: FormatFeature = {
  id: 'whatsapp-native-txt',
  name: 'WhatsApp 官方导出 (TXT)',
  platform: KNOWN_PLATFORMS.WHATSAPP,
  priority: 25,
  extensions: ['.txt'],
  signatures: {
    // WhatsApp 导出文件的特征（中文/英文）
    // 注意：仅保留 WhatsApp 独有的特征，避免误匹配其他 TXT 格式（如 LINE）
    head: [
      /消息和通话已进行端到端加密/, // 中文加密提示（WhatsApp 独有）
      /Messages and calls are end-to-end encrypted/i, // 英文加密提示（WhatsApp 独有）
      /你发送给自己的消息已进行端到端加密/, // 中文自己对话提示（WhatsApp 独有）
      /\d{4}\/\d{1,2}\/\d{1,2} \d{1,2}:\d{2} - /, // 消息行格式特征（无方括号，含 " - " 分隔符，WhatsApp 独有）
      /\[\d{1,4}\/\d{1,2}\/\d{2,4},? \d{1,2}:\d{2}:\d{2}\] /, // 消息行格式特征（方括号 + 秒级时间戳，WhatsApp 独有）
    ],
    // 文件名特征：与xxx的 WhatsApp 聊天.txt
    filename: [/^与.+的\s*WhatsApp\s*聊天\.txt$/i, /WhatsApp/i],
  },
}

// ==================== 辅助函数：清理不可见字符 ====================

/**
 * 清理行首/行尾的不可见 Unicode 字符
 * WhatsApp 导出文件中可能包含 BOM、Left-to-Right Mark (U+200E) 等
 */
function cleanLine(line: string): string {
  // 移除常见的不可见字符：BOM、LTR Mark、RTL Mark、零宽字符等
  return line.replace(/^(?:\uFEFF|\u200E|\u200F|\u200B|\u200C|\u200D|\u2060)+/, '').trim()
}

// ==================== 消息头正则 ====================

// 格式1：2025/12/22 12:35 或 2025/2/2 9:35 - 地瓜: 内容（部分地区导出格式）
// 支持月份、日期、小时为 1-2 位数字
const MESSAGE_LINE_REGEX_V1 = /^(\d{4}\/\d{1,2}\/\d{1,2} \d{1,2}:\d{2}) - (.+)$/

// 格式2（方括号格式）：支持多种地区导出
// - [6/7/25 22:44:26] 或 [10/12/25, 12:50:16]（2 位年份，M/D/YY）
// - [2024/10/31 15:50:46]（4 位年份在前，YYYY/MM/DD，中文地区）
// - [31/10/2024, 15:50:46]（4 位年份在后，DD/MM/YYYY，英文地区）
// 日期和时间之间可能有逗号（英文）或没有（中文）
const MESSAGE_LINE_REGEX_V2 = /^\[(\d{1,4}\/\d{1,2}\/\d{2,4},? \d{1,2}:\d{2}:\d{2})\] (.+)$/

// 从消息内容中分离昵称和实际内容
// 格式：昵称: 内容（冒号后可能是空格、U+200E LTR Mark 或两者组合）
const SENDER_CONTENT_REGEX = /^(.+?):[\s\u200E]+(.*)$/

// ==================== 系统消息识别 ====================

const SYSTEM_MESSAGE_PATTERNS = [
  // 中文系统消息
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
  // 英文系统消息
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

function isSystemMessage(content: string): boolean {
  return SYSTEM_MESSAGE_PATTERNS.some((pattern) => pattern.test(content))
}

// ==================== 消息类型判断 ====================

function detectMessageType(content: string): MessageType {
  const trimmed = content.trim()

  // 媒体消息
  if (trimmed === '<省略影音内容>') return MessageType.IMAGE // 统一归类为图片
  if (trimmed.includes('<已附加:') || trimmed.includes('<附件:')) return MessageType.FILE

  // 删除消息
  if (trimmed === '这条消息已删除') return MessageType.RECALL

  // 系统消息
  if (isSystemMessage(trimmed)) return MessageType.SYSTEM

  return MessageType.TEXT
}

// ==================== 时间解析 ====================

/**
 * 解析 WhatsApp 时间格式为秒级时间戳
 * 支持多种格式：
 * - 格式1：2025/12/22 12:35 或 2025/2/2 9:35（YYYY/M/D H:MM，月日时可为 1-2 位）
 * - 格式2（方括号）：
 *   - 6/7/25 22:44:26（M/D/YY HH:MM:SS，2 位年份）
 *   - 2024/10/31 15:50:46（YYYY/MM/DD HH:MM:SS，4 位年份在前，中文地区）
 *   - 31/10/2024, 15:50:46（DD/MM/YYYY, HH:MM:SS，4 位年份在后，英文地区）
 */
function parseWhatsAppTime(timeStr: string, isV2Format: boolean = false): number {
  if (isV2Format) {
    // 方括号格式：先移除可能的逗号
    const normalizedStr = timeStr.replace(',', '')
    const match = normalizedStr.match(/^(\d{1,4})\/(\d{1,2})\/(\d{2,4}) (\d{1,2}):(\d{2}):(\d{2})$/)
    if (match) {
      const [, part1, part2, part3, hour, minute, second] = match
      let year: number, month: number, day: number

      if (part1.length === 4) {
        // YYYY/MM/DD 格式（中文地区，4 位年份在前）
        year = parseInt(part1, 10)
        month = parseInt(part2, 10)
        day = parseInt(part3, 10)
      } else if (part3.length === 4) {
        // DD/MM/YYYY 格式（英文地区，4 位年份在后）
        day = parseInt(part1, 10)
        month = parseInt(part2, 10)
        year = parseInt(part3, 10)
      } else {
        // M/D/YY 格式（2 位年份，假设 00-99 对应 2000-2099）
        month = parseInt(part1, 10)
        day = parseInt(part2, 10)
        year = 2000 + parseInt(part3, 10)
      }

      const date = new Date(year, month - 1, day, parseInt(hour, 10), parseInt(minute, 10), parseInt(second, 10))
      return Math.floor(date.getTime() / 1000)
    }
  }

  // 格式1：YYYY/M/D H:MM（月、日、时可为 1-2 位数字）
  const match = timeStr.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2}) (\d{1,2}):(\d{2})$/)
  if (match) {
    const [, year, month, day, hour, minute] = match
    const date = new Date(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      parseInt(hour, 10),
      parseInt(minute, 10),
      0
    )
    return Math.floor(date.getTime() / 1000)
  }

  // 兜底：尝试标准格式解析（YYYY/MM/DD HH:MM）
  const normalized = timeStr.replace(/\//g, '-').replace(' ', 'T') + ':00'
  const date = new Date(normalized)
  return Math.floor(date.getTime() / 1000)
}

// ==================== 成员信息 ====================

interface MemberInfo {
  platformId: string
  nickname: string
}

// ==================== 解析器实现 ====================

async function* parseWhatsApp(options: ParseOptions): AsyncGenerator<ParseEvent, void, unknown> {
  const { filePath, batchSize = 5000, onProgress, onLog } = options

  const totalBytes = getFileSize(filePath)
  let bytesRead = 0
  let messagesProcessed = 0
  let skippedLines = 0

  // 发送初始进度
  const initialProgress = createProgress('parsing', 0, totalBytes, 0, '')
  yield { type: 'progress', data: initialProgress }
  onProgress?.(initialProgress)

  // 记录解析开始
  onLog?.('info', `开始解析 WhatsApp TXT 文件，大小: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`)

  // 收集数据
  const chatName = extractNameFromFilePath(filePath)
  const memberMap = new Map<string, MemberInfo>()
  const messages: ParsedMessage[] = []

  // 当前正在解析的消息（可能跨多行）
  let currentMessage: {
    timestamp: number
    sender: string | null // null 表示系统消息
    contentLines: string[]
  } | null = null

  // 保存当前消息
  const saveCurrentMessage = () => {
    if (currentMessage) {
      const content = currentMessage.contentLines.join('\n').trim()
      const type = detectMessageType(content)

      // 系统消息使用特殊 ID 和统一名称
      const senderPlatformId = currentMessage.sender || 'system'
      const senderName = currentMessage.sender || '系统消息'

      messages.push({
        senderPlatformId,
        senderAccountName: senderName,
        timestamp: currentMessage.timestamp,
        type,
        content: content || null,
      })

      // 更新成员信息（跳过系统消息）
      if (currentMessage.sender) {
        memberMap.set(senderPlatformId, {
          platformId: senderPlatformId,
          nickname: senderName,
        })
      }

      messagesProcessed++
    }
  }

  // 逐行读取文件
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' })
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  })

  fileStream.on('data', (chunk: string | Buffer) => {
    bytesRead += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
  })

  for await (const line of rl) {
    // 清理行首不可见字符
    const cleanedLine = cleanLine(line)

    // 尝试匹配消息行（两种格式）
    let lineMatch = cleanedLine.match(MESSAGE_LINE_REGEX_V1)
    let isV2Format = false
    if (!lineMatch) {
      lineMatch = cleanedLine.match(MESSAGE_LINE_REGEX_V2)
      isV2Format = true
    }

    if (lineMatch) {
      // 保存前一条消息
      saveCurrentMessage()

      const timeStr = lineMatch[1]
      const restContent = lineMatch[2]

      // 尝试分离发送者和内容
      const senderMatch = restContent.match(SENDER_CONTENT_REGEX)
      if (senderMatch && !isSystemMessage(restContent)) {
        // 普通消息
        currentMessage = {
          timestamp: parseWhatsAppTime(timeStr, isV2Format),
          sender: senderMatch[1].trim(),
          contentLines: [senderMatch[2]],
        }
      } else {
        // 系统消息
        currentMessage = {
          timestamp: parseWhatsAppTime(timeStr, isV2Format),
          sender: null,
          contentLines: [restContent],
        }
      }

      // 更新进度
      if (messagesProcessed % 500 === 0) {
        const progress = createProgress(
          'parsing',
          bytesRead,
          totalBytes,
          messagesProcessed,
          `已处理 ${messagesProcessed} 条消息...`
        )
        onProgress?.(progress)
      }

      continue
    }

    // 非消息行：可能是多行消息的延续
    if (currentMessage && cleanedLine) {
      currentMessage.contentLines.push(cleanedLine)
    } else if (cleanedLine) {
      // 无法解析的非空行
      skippedLines++
    }
  }

  // 保存最后一条消息
  saveCurrentMessage()

  // 确定聊天类型：根据参与者数量判断
  // - 排除系统成员后，2 人或更少：私聊
  // - 超过 2 人：群聊
  const hasSystemMember = memberMap.has('system')
  const realMemberCount = hasSystemMember ? memberMap.size - 1 : memberMap.size

  const chatType = realMemberCount > 2 ? ChatType.GROUP : ChatType.PRIVATE

  // 发送 meta
  const meta: ParsedMeta = {
    name: chatName,
    platform: KNOWN_PLATFORMS.WHATSAPP,
    type: chatType,
  }
  yield { type: 'meta', data: meta }

  // 发送成员
  const members: ParsedMember[] = Array.from(memberMap.values()).map((m) => ({
    platformId: m.platformId,
    accountName: m.nickname,
  }))
  yield { type: 'members', data: members }

  // 分批发送消息
  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize)
    yield { type: 'messages', data: batch }
  }

  // 完成
  const doneProgress = createProgress('done', totalBytes, totalBytes, messagesProcessed, '')
  yield { type: 'progress', data: doneProgress }
  onProgress?.(doneProgress)

  // 统计消息类型
  const typeCounts = new Map<MessageType, number>()
  for (const msg of messages) {
    typeCounts.set(msg.type, (typeCounts.get(msg.type) || 0) + 1)
  }

  // 记录解析摘要
  onLog?.('info', `解析完成: ${messagesProcessed} 条消息, ${memberMap.size} 个成员, 类型: ${chatType}`)
  onLog?.(
    'info',
    `消息类型统计: ${Array.from(typeCounts.entries())
      .map(([type, count]) => `${type}=${count}`)
      .join(', ')}`
  )
  if (skippedLines > 0) {
    onLog?.('info', `跳过 ${skippedLines} 行无法解析的内容`)
  }

  yield {
    type: 'done',
    data: { messageCount: messagesProcessed, memberCount: memberMap.size },
  }
}

// ==================== 导出解析器 ====================

export const parser_: Parser = {
  feature,
  parse: parseWhatsApp,
}

// ==================== 导出格式模块 ====================

const module_: FormatModule = {
  feature,
  parser: parser_,
  // TXT 格式不需要预处理器
}

export default module_
