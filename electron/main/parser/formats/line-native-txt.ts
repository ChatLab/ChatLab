/**
 * LINE 官方导出 TXT 格式解析器
 * 支持私聊和群聊，支持多语言导出（EN / ZH-CN / ZH-TW / JA）
 *
 * 格式特征：
 * - 头部格式（私聊和群聊相同）：
 *   Line 1: [LINE] {name}的聊天记录 / Chat history with/in {name} / ...
 *   Line 2: 保存日期: YYYY/MM/DD HH:MM / Saved on: ...
 *   Line 3: (空行)
 * - 日期行：YYYY/MM/DD（星期）或 Day, MM/DD/YYYY
 * - 消息格式：TIME\t{sender}\t{content}（Tab 分隔）
 * - 系统消息：TIME\t\t{content}（双 Tab，无发送者）
 * - 时间格式：HH:MM / 上午|下午HH:MM / 午前|午後HH:MM / HH:MMam|pm
 * - 多行消息：用双引号包裹
 *
 * 私聊 vs 群聊区分：
 * - EN: "Chat history with {name}" (私聊) vs "Chat history in {name}" (群聊)
 * - JA: "{name}とのトーク履歴" (私聊) vs "{name}のトーク履歴" (群聊)
 * - ZH-CN: "与{name}的聊天记录" (私聊) vs "{name}的聊天记录" (群聊)
 * - ZH-TW: "與{name}的聊天記錄" (私聊) vs "{name}的聊天記錄" (群聊)
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
  id: 'line-native-txt',
  name: 'LINE 官方导出 TXT',
  platform: KNOWN_PLATFORMS.LINE,
  priority: 35,
  extensions: ['.txt'],
  signatures: {
    head: [
      // 头部标识（多语言）
      /^\[LINE\] /m,
      /^(?:\[LINE\] )?Chat history (?:with|in) /m,
      // Tab 分隔的消息格式（支持多种时间格式）
      /^((?:上午|下午|午前|午後)?\d{1,2}:\d{2}(?:[AaPp][Mm])?)\t[^\t\n]+\t/m,
      // 空格分隔的消息格式（部分 LINE 导出）
      /^((?:上午|下午|午前|午後)?\d{1,2}:\d{2}(?:[AaPp][Mm])?) [^\s]+ /m,
      // LINE 独有的日期行格式：YYYY.MM.DD DayOfWeek（英文星期全称）
      /^\d{4}\.\d{2}\.\d{2}\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/m,
      // LINE 日文/中文日期行格式：YYYY/M/D(曜日)
      /^\d{4}\/\d{1,2}\/\d{1,2}[（(][月火水木金土日]/m,
      // LINE 中文日期行格式：YYYY/M/D周X
      /^\d{4}\/\d{1,2}\/\d{1,2}周/m,
    ],
    // 文件名特征：[LINE] 出现在文件名中
    filename: [/\[LINE\]/i],
  },
}

// ==================== 辅助函数 ====================

/**
 * 从文件名提取聊天名称
 */
function extractNameFromFilePath(filePath: string): string {
  const basename = path.basename(filePath, '.txt')
  // 移除 [LINE] 前缀
  const name = basename.replace(/^\[LINE\]\s*/i, '').trim()
  return name || '未知聊天'
}

/**
 * 从头部提取聊天名称和类型
 * 支持：英文、日文、简体中文、繁体中文
 */
function extractNameFromHeader(header: string): { name: string; isGroup: boolean } | null {
  // ===== 英文 =====
  // 私聊：Chat history with {name}
  const enPrivateMatch = header.match(/^(?:\[LINE\] )?Chat history with (.+)$/m)
  if (enPrivateMatch) return { name: enPrivateMatch[1].trim(), isGroup: false }
  // 群聊：Chat history in {name}
  const enGroupMatch = header.match(/^(?:\[LINE\] )?Chat history in (.+)$/m)
  if (enGroupMatch) return { name: enGroupMatch[1].trim(), isGroup: true }

  // ===== 日文 =====
  // 私聊：{name}とのトーク履歴
  const jaPrivateMatch = header.match(/^\[LINE\] (.+)とのトーク履歴/)
  if (jaPrivateMatch) return { name: jaPrivateMatch[1].trim(), isGroup: false }
  // 群聊：{name}のトーク履歴
  const jaGroupMatch = header.match(/^\[LINE\] (.+)のトーク履歴/)
  if (jaGroupMatch) return { name: jaGroupMatch[1].trim(), isGroup: true }

  // ===== 简体中文 =====
  // 私聊：与{name}的聊天记录
  const zhCnPrivateMatch = header.match(/^\[LINE\] 与(.+)的聊天记录/)
  if (zhCnPrivateMatch) return { name: zhCnPrivateMatch[1].trim(), isGroup: false }
  // 群聊：{name}的聊天记录
  const zhCnGroupMatch = header.match(/^\[LINE\] (.+)的聊天记录/)
  if (zhCnGroupMatch) return { name: zhCnGroupMatch[1].trim(), isGroup: true }

  // ===== 繁体中文 =====
  // 私聊：與{name}的聊天記錄
  const zhTwPrivateMatch = header.match(/^\[LINE\] 與(.+)的聊天記錄/)
  if (zhTwPrivateMatch) return { name: zhTwPrivateMatch[1].trim(), isGroup: false }
  // 群聊：{name}的聊天記錄
  const zhTwGroupMatch = header.match(/^\[LINE\] (.+)的聊天記錄/)
  if (zhTwGroupMatch) return { name: zhTwGroupMatch[1].trim(), isGroup: true }

  return null
}

/**
 * 日期行正则模式
 */
const DATE_PATTERNS = [
  // 2025.12.10 Wednesday
  /^(\d{4})\.(\d{2})\.(\d{2})\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?/,
  // 2026/1/30周五 or 2026/1/30(金)
  /^(\d{4})\/(\d{1,2})\/(\d{1,2})/,
  // Fri, 1/30/2026
  /^[A-Za-z]+,\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/,
]

/**
 * 尝试解析日期行
 */
function parseDateLine(line: string): Date | null {
  for (const pattern of DATE_PATTERNS) {
    const match = line.match(pattern)
    if (match) {
      // 根据不同格式提取年月日
      if (pattern === DATE_PATTERNS[0] || pattern === DATE_PATTERNS[1]) {
        // YYYY.MM.DD or YYYY/M/D
        const year = parseInt(match[1])
        const month = parseInt(match[2]) - 1
        const day = parseInt(match[3])
        return new Date(year, month, day)
      } else if (pattern === DATE_PATTERNS[2]) {
        // M/D/YYYY
        const month = parseInt(match[1]) - 1
        const day = parseInt(match[2])
        const year = parseInt(match[3])
        return new Date(year, month, day)
      }
    }
  }
  return null
}

/**
 * 消息行正则模式
 * 时间格式：HH:MM / HH:MMam|pm / 上午|下午|午前|午後HH:MM
 */
// 私聊/群聊（有发送者）：TIME\t{name}\t{content}
const PRIVATE_MSG_PATTERN = /^((?:上午|下午|午前|午後)?\d{1,2}:\d{2}(?:[AaPp][Mm])?)\t([^\t]+)\t(.*)$/
// 群聊：HH:MM {name} {content} (已废弃，实际都用 Tab 分隔)
const GROUP_MSG_PATTERN = /^((?:上午|下午|午前|午後)?\d{1,2}:\d{2}(?:[AaPp][Mm])?) ([^\s]+) (.*)$/
// 系统消息：双 Tab（无发送者），如「下午07:04\t\tXXX已加入群組」
const SYSTEM_MSG_PATTERN = /^((?:上午|下午|午前|午後)?\d{1,2}:\d{2}(?:[AaPp][Mm])?)\t\t(.+)$/

/**
 * 特殊消息类型映射（多语言：EN / ZH-CN / ZH-TW / JA）
 */
const SPECIAL_MESSAGE_TYPES: Record<string, MessageType> = {
  // 图片 / Photo
  '[Photo]': MessageType.IMAGE, // EN
  '[照片]': MessageType.IMAGE, // ZH-CN / ZH-TW
  '[写真]': MessageType.IMAGE, // JA
  Photos: MessageType.IMAGE, // EN (fallback)

  // 语音 / Voice
  '[Voice message]': MessageType.VOICE, // EN
  '[语音信息]': MessageType.VOICE, // ZH-CN
  '[語音訊息]': MessageType.VOICE, // ZH-TW
  '[ボイスメッセージ]': MessageType.VOICE, // JA
  Audio: MessageType.VOICE, // EN (fallback)

  // 视频 / Video
  '[Video]': MessageType.VIDEO, // EN
  '[视频]': MessageType.VIDEO, // ZH-CN
  '[影片]': MessageType.VIDEO, // ZH-TW
  '[動画]': MessageType.VIDEO, // JA
  Videos: MessageType.VIDEO, // EN (fallback)

  // 文件 / File
  '[File]': MessageType.FILE, // EN
  '[文件]': MessageType.FILE, // ZH-CN
  '[檔案]': MessageType.FILE, // ZH-TW
  '[ファイル]': MessageType.FILE, // JA

  // 贴纸 / Sticker
  '[Sticker]': MessageType.EMOJI, // EN
  '[贴图]': MessageType.EMOJI, // ZH-CN
  '[貼圖]': MessageType.EMOJI, // ZH-TW
  '[スタンプ]': MessageType.EMOJI, // JA
  Stickers: MessageType.EMOJI, // EN (fallback)

  // 位置 / Location
  '[Location]': MessageType.LOCATION, // EN
  '[位置]': MessageType.LOCATION, // ZH-CN / ZH-TW
  '[位置情報]': MessageType.LOCATION, // JA

  // 记事本 / Notes
  '[Notes]': MessageType.TEXT, // EN
  '[记事本]': MessageType.TEXT, // ZH-CN
  '[記事本]': MessageType.TEXT, // ZH-TW
  '[ノート]': MessageType.TEXT, // JA
}

/**
 * 检测消息类型
 */
function detectMessageType(content: string): MessageType {
  // 检查特殊消息类型
  for (const [pattern, type] of Object.entries(SPECIAL_MESSAGE_TYPES)) {
    if (content === pattern || content.startsWith(pattern)) {
      return type
    }
  }

  // 检查 [null] 开头的位置消息
  if (content.startsWith('[null]') && content.includes('maps.google.com')) {
    return MessageType.LOCATION
  }

  // 检查系统消息（多语言：EN / ZH-CN / ZH-TW / JA）
  if (
    // --- 加入群组 / Join group ---
    content.includes(' joined the group') || // EN
    content.includes('已加入该群') || // ZH-CN
    content.includes('已加入群組') || // ZH-TW
    content.includes('がグループに参加しました') || // JA
    // --- 拉人进群 / Added to group ---
    content.includes(' added ') || // EN
    content.includes(' to the group') || // EN
    content.includes('已将') || // ZH-CN
    content.includes('添加至群') || // ZH-CN
    content.includes('添加到群') || // ZH-CN (另一格式)
    content.includes('已新增') || // ZH-TW
    content.includes('至群組') || // ZH-TW
    content.includes('をグループに追加しました') || // JA
    // --- 退出群组 / Left group ---
    content.includes(' left the group') || // EN
    content.includes('已退群') || // ZH-CN
    content.includes('已離開群組') || // ZH-TW
    content.includes('がグループを退会しました') || // JA
    // --- 设定公告 / Announcement ---
    content.includes('made an announcement') || // EN
    content.includes('发布了通告') || // ZH-CN
    content.includes('已設定公告') || // ZH-TW
    content.includes('がアナウンスしました') || // JA
    // --- 收回讯息 / Unsent message ---
    content.includes('unsent a message') || // EN
    content === 'Message unsent.' || // EN
    content.includes('撤回了一条消息') || // ZH-CN
    content.includes('已收回訊息') || // ZH-TW
    content.includes('送信を取り消しました') || // JA
    // --- 其他 / Others ---
    content.startsWith('Auto-reply') // EN 自动回复
  ) {
    return MessageType.SYSTEM
  }

  // 检查链接
  if (content.match(/^https?:\/\//)) {
    return MessageType.LINK
  }

  return MessageType.TEXT
}

// ==================== 解析器实现 ====================

async function* parseLINE(options: ParseOptions): AsyncGenerator<ParseEvent, void, unknown> {
  const { filePath, batchSize = 5000, onProgress, onLog } = options

  const totalBytes = getFileSize(filePath)
  let messagesProcessed = 0

  // 发送初始进度
  const initialProgress = createProgress('parsing', 0, totalBytes, 0, '')
  yield { type: 'progress', data: initialProgress }
  onProgress?.(initialProgress)

  onLog?.('info', `开始解析 LINE 导出文件，大小: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`)

  // 读取整个文件（LINE 导出通常不大）
  const content = fs.readFileSync(filePath, 'utf-8')
  // 处理 Windows 换行符 (\r\n)
  const lines = content.split('\n').map((line) => line.replace(/\r$/, ''))

  // 解析状态
  let currentDate: Date | null = null
  let chatName = extractNameFromFilePath(filePath)
  let isPrivateChat = false
  let useTabSeparator = false
  const memberMap = new Map<string, ParsedMember>()
  const messages: ParsedMessage[] = []
  let lastMessage: ParsedMessage | null = null
  let lineIndex = 0

  // 检测是否有头部
  if (lines.length > 0) {
    const firstLine = lines[0].trim()
    onLog?.('debug', `LINE 第一行: "${firstLine}"`)
    const headerResult = extractNameFromHeader(firstLine)
    if (headerResult) {
      chatName = headerResult.name
      isPrivateChat = !headerResult.isGroup
      useTabSeparator = true // 两种头部格式都使用 Tab 分隔
      lineIndex = 3 // 跳过头部（标题、保存时间、空行）
      onLog?.('debug', `LINE 检测到头部，名称: ${headerResult.name}, 群聊: ${headerResult.isGroup}`)
    }
  }

  // 如果没有检测到头部，检查第一条消息的格式
  if (!isPrivateChat && lines.length > 0) {
    for (const line of lines) {
      if (PRIVATE_MSG_PATTERN.test(line)) {
        useTabSeparator = true
        onLog?.('debug', `LINE 检测到 Tab 分隔格式`)
        break
      }
      if (GROUP_MSG_PATTERN.test(line)) {
        useTabSeparator = false
        onLog?.('debug', `LINE 检测到空格分隔格式`)
        break
      }
    }
  }

  onLog?.('debug', `LINE 解析配置: useTabSeparator=${useTabSeparator}, lineIndex=${lineIndex}`)

  // 解析消息
  let debugLogCount = 0
  for (let i = lineIndex; i < lines.length; i++) {
    const line = lines[i]

    // 尝试解析日期行
    const dateResult = parseDateLine(line)
    if (dateResult) {
      currentDate = dateResult
      if (debugLogCount < 5) {
        onLog?.('debug', `LINE 日期行[${i}]: ${line} -> ${dateResult.toISOString()}`)
      }
      continue
    }

    // 尝试解析消息行
    const msgPattern = useTabSeparator ? PRIVATE_MSG_PATTERN : GROUP_MSG_PATTERN
    const msgMatch = line.match(msgPattern)

    // 调试前几行
    if (debugLogCount < 5 && line.trim()) {
      onLog?.('debug', `LINE 行[${i}]: "${line.substring(0, 50)}..." match=${!!msgMatch}`)
      debugLogCount++
    }

    if (msgMatch) {
      const [, timeStr, sender, contentRaw] = msgMatch
      let content = contentRaw.trim()

      // 处理 LINE 导出的多行消息格式（用双引号包裹）
      let isQuotedMultiline = false
      if (content.startsWith('"')) {
        content = content.substring(1) // 移除开头的引号
        isQuotedMultiline = !content.endsWith('"') // 单行带引号则直接处理
        if (content.endsWith('"')) {
          content = content.substring(0, content.length - 1) // 移除结尾引号
        }
      }

      // 解析时间（支持中文上午/下午、日文午前/午後、英文am/pm）
      let hours = 0
      let minutes = 0

      const prefix = timeStr.match(/^(上午|下午|午前|午後)/)?.[1]
      const cleanTime = timeStr.replace(/^(上午|下午|午前|午後)/, '')
      const partsMatch = cleanTime.match(/^(\d{1,2}):(\d{2})([AaPp][Mm])?$/i)

      if (partsMatch) {
        hours = parseInt(partsMatch[1])
        minutes = parseInt(partsMatch[2])
        const suffix = partsMatch[3]?.toLowerCase()

        // 英文后缀
        if (suffix === 'pm' && hours < 12) hours += 12
        if (suffix === 'am' && hours === 12) hours = 0

        // 中文/日文前缀 (下午/午後 = PM, 上午/午前 = AM)
        if ((prefix === '下午' || prefix === '午後') && hours < 12) hours += 12
        if ((prefix === '上午' || prefix === '午前') && hours === 12) hours = 0
      } else {
        // Fallback
        const parts = timeStr.split(':').map(Number)
        hours = parts[0]
        minutes = parts[1]
      }

      let timestamp: number

      if (currentDate) {
        const msgDate = new Date(currentDate)
        msgDate.setHours(hours, minutes, 0, 0)
        timestamp = Math.floor(msgDate.getTime() / 1000)
      } else {
        // 如果没有日期，使用当前日期
        const now = new Date()
        now.setHours(hours, minutes, 0, 0)
        timestamp = Math.floor(now.getTime() / 1000)
      }

      // 检测消息类型
      const msgType = detectMessageType(content)

      // 更新成员信息
      if (!memberMap.has(sender)) {
        memberMap.set(sender, {
          platformId: sender,
          accountName: sender,
        })
      }

      // 创建消息
      lastMessage = {
        senderPlatformId: sender,
        senderAccountName: sender,
        timestamp,
        type: msgType,
        content: content || null,
        _isQuotedMultiline: isQuotedMultiline, // 临时标记，用于追加多行内容时处理结尾引号
      } as ParsedMessage & { _isQuotedMultiline?: boolean }
      messages.push(lastMessage)
      messagesProcessed++

      // 更新进度
      if (messagesProcessed % 1000 === 0) {
        const progress = createProgress(
          'parsing',
          i,
          lines.length,
          messagesProcessed,
          `已处理 ${messagesProcessed} 条消息...`
        )
        onProgress?.(progress)
      }
    } else {
      // 尝试解析系统消息（双 Tab）
      const systemMatch = line.match(SYSTEM_MSG_PATTERN)
      if (systemMatch) {
        const [, timeStr, contentRaw] = systemMatch
        const content = contentRaw.trim()

        // 解析时间（支持中文、日文、英文）
        let hours = 0
        let minutes = 0

        const prefix = timeStr.match(/^(上午|下午|午前|午後)/)?.[1]
        const cleanTime = timeStr.replace(/^(上午|下午|午前|午後)/, '')
        const partsMatch = cleanTime.match(/^(\d{1,2}):(\d{2})([AaPp][Mm])?$/i)

        if (partsMatch) {
          hours = parseInt(partsMatch[1])
          minutes = parseInt(partsMatch[2])
          const suffix = partsMatch[3]?.toLowerCase()

          if (suffix === 'pm' && hours < 12) hours += 12
          if (suffix === 'am' && hours === 12) hours = 0

          if ((prefix === '下午' || prefix === '午後') && hours < 12) hours += 12
          if ((prefix === '上午' || prefix === '午前') && hours === 12) hours = 0
        } else {
          const parts = timeStr.split(':').map(Number)
          hours = parts[0]
          minutes = parts[1]
        }

        let timestamp: number
        if (currentDate) {
          const msgDate = new Date(currentDate)
          msgDate.setHours(hours, minutes, 0, 0)
          timestamp = Math.floor(msgDate.getTime() / 1000)
        } else {
          const now = new Date()
          now.setHours(hours, minutes, 0, 0)
          timestamp = Math.floor(now.getTime() / 1000)
        }

        // 创建系统消息
        lastMessage = {
          senderPlatformId: 'system',
          senderAccountName: '系統',
          timestamp,
          type: MessageType.SYSTEM,
          content: content || null,
        }
        messages.push(lastMessage)
        messagesProcessed++
      } else if (line.trim() && lastMessage) {
        // 非消息行，追加到上一条消息（多行内容）
        let appendLine = line
        const quotedMsg = lastMessage as ParsedMessage & { _isQuotedMultiline?: boolean }

        // 检查是否为带引号多行消息的最后一行（以 " 结尾）
        if (quotedMsg._isQuotedMultiline && appendLine.endsWith('"')) {
          appendLine = appendLine.substring(0, appendLine.length - 1) // 移除结尾引号
          delete quotedMsg._isQuotedMultiline // 清除临时标记
        }

        if (lastMessage.content) {
          lastMessage.content += '\n' + appendLine
        } else {
          lastMessage.content = appendLine
        }
      }
    }
  }

  // 根据成员数判断聊天类型
  const memberCount = memberMap.size
  const chatType = memberCount <= 2 ? ChatType.PRIVATE : ChatType.GROUP

  // 发送 meta
  const meta: ParsedMeta = {
    name: chatName,
    platform: KNOWN_PLATFORMS.LINE,
    type: chatType,
  }
  yield { type: 'meta', data: meta }

  // 发送成员
  const members = Array.from(memberMap.values())
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

  onLog?.('info', `解析完成: ${messagesProcessed} 条消息, ${memberCount} 个成员`)

  yield {
    type: 'done',
    data: { messageCount: messagesProcessed, memberCount },
  }
}

// ==================== 导出 ====================

export const parser_: Parser = {
  feature,
  parse: parseLINE,
}

const module_: FormatModule = {
  feature,
  parser: parser_,
}

export default module_
