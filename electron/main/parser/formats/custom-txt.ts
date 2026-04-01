/**
 * 自定义 TXT 格式解析器
 * 支持格式：昵称(ID)\tYYYY-MM-DD HH:mm:ss\n消息内容
 *
 * 格式特征：
 * - 消息头：昵称(ID)\t时间戳，ID格式为首字符+8位数字
 * - 消息内容：紧随消息头下一行，支持多行
 * - 群名：从文件名提取
 * - 特殊消息：[图片]、[文件] 作为占位符
 *
 * 解析逻辑：
 * - 遇到消息头行（匹配格式）→ 开始新消息
 * - 非消息头行 → 追加到当前消息内容
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
 * 从文件名提取群名
 */
function extractNameFromFilePath(filePath: string): string {
  const basename = path.basename(filePath)
  const name = basename.replace(/\.txt$/i, '')
  return name || '未知群聊'
}

// ==================== 特征定义 ====================

export const feature: FormatFeature = {
  id: 'custom-txt',
  name: '自定义 TXT 格式',
  platform: KNOWN_PLATFORMS.UNKNOWN,
  priority: 40,
  extensions: ['.txt'],
  signatures: {
    // 消息头格式：昵称(ID)\t时间戳
    // ID格式：首字符 + 8位数字，如 z00123456
    head: [/^[^\t]+\([a-zA-Z]\d{8}\)\t\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/m],
  },
}

// ==================== 消息头正则 ====================

// 匹配格式：昵称(ID)\tYYYY-MM-DD HH:mm:ss
// ID格式：首字符 + 8位数字
const MESSAGE_HEADER_REGEX = /^([^\t]+)\(([a-zA-Z]\d{8})\)\t(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})$/

// ==================== 消息类型判断 ====================

/**
 * 检测消息类型
 */
function detectMessageType(content: string): MessageType {
  const trimmed = content.trim()

  // 图片
  if (trimmed === '[图片]' || trimmed === '[image]' || trimmed === '[照片]') {
    return MessageType.IMAGE
  }

  // 文件
  if (trimmed.startsWith('[文件]') || trimmed.startsWith('[file]')) {
    return MessageType.FILE
  }

  // 语音
  if (trimmed === '[语音]' || trimmed === '[voice]' || trimmed === '[语音消息]') {
    return MessageType.VOICE
  }

  // 视频
  if (trimmed === '[视频]' || trimmed === '[video]') {
    return MessageType.VIDEO
  }

  // 链接
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return MessageType.LINK
  }

  return MessageType.TEXT
}

// ==================== 时间解析 ====================

/**
 * 解析本地时间字符串为秒级时间戳
 * @param timeStr 格式：2026-03-31 09:15:32
 * @param onLog 可选的日志回调
 */
function parseLocalTime(
  timeStr: string,
  onLog?: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void
): number {
  try {
    const date = new Date(timeStr.replace(' ', 'T'))
    const timestamp = date.getTime()

    // 检查是否为有效日期
    if (isNaN(timestamp)) {
      onLog?.('warn', `[CustomTxt] 时间解析失败，无效日期格式: "${timeStr}"，使用当前时间`)
      return Math.floor(Date.now() / 1000)
    }

    return Math.floor(timestamp / 1000)
  } catch (error) {
    onLog?.('error', `[CustomTxt] 时间解析异常: "${timeStr}", 错误: ${error}`)
    return Math.floor(Date.now() / 1000)
  }
}

// ==================== 成员信息 ====================

interface MemberInfo {
  platformId: string
  nickname: string
}

// ==================== 解析器实现 ====================

async function* parseCustomTxt(options: ParseOptions): AsyncGenerator<ParseEvent, void, unknown> {
  const { filePath, batchSize = 5000, onProgress, onLog } = options

  // 性能监控：记录开始时间
  const startTime = Date.now()

  const totalBytes = getFileSize(filePath)
  let bytesRead = 0
  let messagesProcessed = 0
  let skippedLines = 0

  // 发送初始进度
  const initialProgress = createProgress('parsing', 0, totalBytes, 0, '')
  yield { type: 'progress', data: initialProgress }
  onProgress?.(initialProgress)

  // 记录解析开始
  onLog?.('info', `[CustomTxt] 开始解析文件，大小: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`)
  onLog?.('info', `[CustomTxt] 文件路径: ${filePath}`)

  // 收集数据
  const groupName = extractNameFromFilePath(filePath)
  onLog?.('info', `[CustomTxt] 从文件名提取群名: ${groupName}`)

  const memberMap = new Map<string, MemberInfo>()
  const messages: ParsedMessage[] = []

  // 当前正在解析的消息
  let currentMessage: {
    platformId: string
    nickname: string
    timestamp: number
    contentLines: string[]
  } | null = null

  // 保存当前消息
  const saveCurrentMessage = () => {
    if (currentMessage) {
      const content = currentMessage.contentLines.join('\n').trim()
      const type = detectMessageType(content)

      messages.push({
        senderPlatformId: currentMessage.platformId,
        senderAccountName: currentMessage.nickname,
        timestamp: currentMessage.timestamp,
        type,
        content: content || null,
      })

      // 更新成员信息
      if (!memberMap.has(currentMessage.platformId)) {
        memberMap.set(currentMessage.platformId, {
          platformId: currentMessage.platformId,
          nickname: currentMessage.nickname,
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

  let lineNum = 0
  for await (const rawLine of rl) {
    lineNum++

    // 去除行尾空白字符（处理尾随空格/制表符）
    const line = rawLine.trimEnd()

    // 检查消息头
    const headerMatch = line.match(MESSAGE_HEADER_REGEX)
    if (headerMatch) {
      // 保存前一条消息
      saveCurrentMessage()

      const nickname = headerMatch[1].trim()
      const platformId = headerMatch[2]
      const timeStr = headerMatch[3]
      const timestamp = parseLocalTime(timeStr, onLog)

      onLog?.(
        'debug',
        `[CustomTxt] 行 ${lineNum}: 解析到消息头 - 昵称="${nickname}", ID="${platformId}", 时间=${timeStr}, 时间戳=${timestamp}`
      )

      currentMessage = {
        platformId,
        nickname,
        timestamp,
        contentLines: [],
      }

      // 更新进度
      if (messagesProcessed % 1000 === 0 && messagesProcessed > 0) {
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

    // 内容行（追加到当前消息）
    if (currentMessage) {
      currentMessage.contentLines.push(line)
    } else {
      // 没有当前消息时，这是无效行
      const trimmed = line.trim()
      if (trimmed) {
        onLog?.('warn', `[CustomTxt] 行 ${lineNum}: 跳过无效行 - "${line.substring(0, 50)}..."`)
        skippedLines++
      }
    }
  }

  // 保存最后一条消息
  saveCurrentMessage()

  // 发送 meta
  const meta: ParsedMeta = {
    name: groupName,
    platform: KNOWN_PLATFORMS.UNKNOWN,
    type: ChatType.GROUP,
  }
  yield { type: 'meta', data: meta }
  onLog?.('info', `[CustomTxt] 发送元信息: 群名="${groupName}", 平台="${KNOWN_PLATFORMS.UNKNOWN}", 类型=群聊`)

  // 发送成员
  const members: ParsedMember[] = Array.from(memberMap.values()).map((m) => ({
    platformId: m.platformId,
    accountName: m.nickname,
  }))
  yield { type: 'members', data: members }
  onLog?.('info', `[CustomTxt] 发送成员列表: ${members.length} 个成员`)

  // 分批发送消息
  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize)
    yield { type: 'messages', data: batch }
  }

  // 完成
  const doneProgress = createProgress('done', totalBytes, totalBytes, messagesProcessed, '')
  yield { type: 'progress', data: doneProgress }
  onProgress?.(doneProgress)

  // 记录解析摘要
  const elapsed = Date.now() - startTime
  onLog?.('info', `[CustomTxt] 解析完成: ${messagesProcessed} 条消息, ${memberMap.size} 个成员, 耗时 ${elapsed}ms`)
  if (skippedLines > 0) {
    onLog?.('warn', `[CustomTxt] 跳过 ${skippedLines} 行无法解析的内容`)
  }
  if (messagesProcessed > 0) {
    onLog?.('debug', `[CustomTxt] 平均处理速度: ${(elapsed / messagesProcessed).toFixed(2)}ms/条`)
  }

  yield {
    type: 'done',
    data: { messageCount: messagesProcessed, memberCount: memberMap.size },
  }
}

// ==================== 导出解析器 ====================

export const parser_: Parser = {
  feature,
  parse: parseCustomTxt,
}

// ==================== 导出格式模块 ====================

const module_: FormatModule = {
  feature,
  parser: parser_,
}

export default module_
