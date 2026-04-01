/**
 * ChatLab JSON 格式
 * ChatLab 专属的统一格式（通过 chatlab 对象识别）
 *
 * 特征：
 * - 文件头包含 "chatlab" 字段
 * - 有 version 版本号
 * - 消息结构已经是标准化的
 */

import * as fs from 'fs'
import { parser } from 'stream-json'
import { pick } from 'stream-json/filters/Pick'
import { streamValues } from 'stream-json/streamers/StreamValues'
import { chain } from 'stream-chain'
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
import { getFileSize, createProgress, readFileHeadBytes } from '../utils'
import * as path from 'path'

// ==================== 辅助函数 ====================

/**
 * 从文件名提取群名
 * 返回不含扩展名的文件名
 */
function extractNameFromFilePath(filePath: string): string {
  const basename = path.basename(filePath)
  // 移除 .json 扩展名
  const name = basename.replace(/\.json$/i, '')
  return name || '未知群聊'
}

// ==================== 特征定义 ====================

export const feature: FormatFeature = {
  id: 'chatlab',
  name: 'ChatLab JSON',
  platform: KNOWN_PLATFORMS.UNKNOWN, // ChatLab 格式可能包含多平台数据
  priority: 50, // 低优先级，让其他格式先匹配
  extensions: ['.json'],
  signatures: {
    // 只要求 chatlab 字段在文件头，其他字段在解析时验证
    head: [/"chatlab"\s*:\s*\{/],
    requiredFields: ['chatlab'],
  },
}

// ==================== 消息结构 ====================

interface ChatLabMessage {
  platformMessageId?: string // 消息的平台原始 ID（用于回复关联查询）
  sender: string // platformId
  accountName: string // 发送时的账号名称
  groupNickname?: string // 发送时的群昵称
  timestamp: number // 秒级时间戳
  type: number // MessageType
  content: string | null
  replyToMessageId?: string // 回复的目标消息 ID（平台原始 ID）
}

interface ChatLabMember {
  platformId: string
  accountName: string // 账号名称
  groupNickname?: string // 群昵称
  aliases?: string[]
  avatar?: string // 头像（base64 Data URL）
  roles?: Array<{ id: string; name?: string }> // 成员角色
}

// ==================== 解析器实现 ====================

async function* parseChatLab(options: ParseOptions): AsyncGenerator<ParseEvent, void, unknown> {
  const { filePath, batchSize = 5000, onProgress, onLog } = options

  const totalBytes = getFileSize(filePath)
  let bytesRead = 0
  let messagesProcessed = 0

  // 发送初始进度
  const initialProgress = createProgress('parsing', 0, totalBytes, 0, '')
  yield { type: 'progress', data: initialProgress }
  onProgress?.(initialProgress)

  // 记录解析开始
  onLog?.('info', `开始解析 ChatLab 格式文件，大小: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`)

  // 读取文件头获取 meta 和 members 信息
  const headContent = readFileHeadBytes(filePath, 200000)

  // 解析 meta
  let meta: ParsedMeta = {
    name: '未知群聊',
    platform: KNOWN_PLATFORMS.UNKNOWN,
    type: ChatType.GROUP,
  }
  try {
    // 使用更健壮的方式解析嵌套 JSON 对象
    // 因为 meta 可能包含 sources 数组（嵌套对象），简单的正则无法正确匹配
    const metaStartMatch = headContent.match(/"meta"\s*:\s*\{/)
    if (metaStartMatch && metaStartMatch.index !== undefined) {
      const startIndex = metaStartMatch.index + metaStartMatch[0].length - 1 // 指向 {
      let depth = 0
      let endIndex = startIndex

      // 遍历字符找到匹配的闭合 }
      for (let i = startIndex; i < headContent.length; i++) {
        const char = headContent[i]
        if (char === '{') {
          depth++
        } else if (char === '}') {
          depth--
          if (depth === 0) {
            endIndex = i
            break
          }
        }
      }

      if (endIndex > startIndex) {
        const metaJson = headContent.slice(startIndex, endIndex + 1)
        const metaObj = JSON.parse(metaJson)
        meta = {
          name: metaObj.name || '未知群聊',
          platform: metaObj.platform || KNOWN_PLATFORMS.UNKNOWN,
          type: (metaObj.type as ChatType) || ChatType.GROUP,
          groupId: metaObj.groupId,
          groupAvatar: metaObj.groupAvatar,
        }
      }
    }
  } catch {
    // 使用默认值
  }

  // 如果群名仍是默认值，使用文件名作为后备
  if (meta.name === '未知群聊') {
    meta.name = extractNameFromFilePath(filePath)
  }

  yield { type: 'meta', data: meta }

  // 解析 members（如果在文件开头能找到）
  const members: ParsedMember[] = []
  try {
    const membersMatch = headContent.match(/"members"\s*:\s*\[([\s\S]*?)\]/)
    if (membersMatch) {
      const membersJson = JSON.parse(`[${membersMatch[1]}]`) as ChatLabMember[]
      for (const m of membersJson) {
        members.push({
          platformId: m.platformId,
          accountName: m.accountName,
          groupNickname: m.groupNickname,
          avatar: m.avatar,
          roles: m.roles,
        })
      }
    }
  } catch {
    // members 可能太大，稍后从消息中收集
  }

  // 收集成员和消息
  const memberMapFromMessages = new Map<string, ParsedMember>()
  const messageBatch: ParsedMessage[] = []

  // 流式解析
  await new Promise<void>((resolve, reject) => {
    const readStream = fs.createReadStream(filePath, { encoding: 'utf-8' })

    readStream.on('data', (chunk: string | Buffer) => {
      bytesRead += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
    })

    const pipeline = chain([readStream, parser(), pick({ filter: /^messages\.\d+$/ }), streamValues()])

    // 用于收集批次的临时数组
    const batchCollector: ParsedMessage[] = []

    pipeline.on('data', ({ value }: { value: ChatLabMessage }) => {
      const msg = value

      // 如果前面没解析到 members，从消息中收集
      if (members.length === 0) {
        memberMapFromMessages.set(msg.sender, {
          platformId: msg.sender,
          accountName: msg.accountName,
          groupNickname: msg.groupNickname,
        })
      }

      batchCollector.push({
        senderPlatformId: msg.sender,
        senderAccountName: msg.accountName,
        senderGroupNickname: msg.groupNickname,
        timestamp: msg.timestamp,
        type: msg.type,
        content: msg.content,
        platformMessageId: msg.platformMessageId,
        replyToMessageId: msg.replyToMessageId,
      })

      messagesProcessed++

      // 达到批次大小
      if (batchCollector.length >= batchSize) {
        messageBatch.push(...batchCollector)
        batchCollector.length = 0

        const progress = createProgress(
          'parsing',
          bytesRead,
          totalBytes,
          messagesProcessed,
          `已处理 ${messagesProcessed} 条消息...`
        )
        onProgress?.(progress)
      }
    })

    pipeline.on('end', () => {
      // 收集剩余消息
      if (batchCollector.length > 0) {
        messageBatch.push(...batchCollector)
      }
      resolve()
    })

    pipeline.on('error', reject)
  })

  // 发送成员
  if (members.length > 0) {
    yield { type: 'members', data: members }
  } else if (memberMapFromMessages.size > 0) {
    yield { type: 'members', data: Array.from(memberMapFromMessages.values()) }
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
  const memberCount = members.length > 0 ? members.length : memberMapFromMessages.size
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

export const parser_: Parser = {
  feature,
  parse: parseChatLab,
}

// ==================== 导出格式模块 ====================

const module_: FormatModule = {
  feature,
  parser: parser_,
}

export default module_
