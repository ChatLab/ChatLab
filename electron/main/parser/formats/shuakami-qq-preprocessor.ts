/**
 * shuakami/qq-chat-exporter 格式预处理器
 * 适配项目: https://github.com/shuakami/qq-chat-exporter
 *
 * 功能：移除 content.html、content.raw 等冗余字段，减小文件体积
 * 阈值：>50MB 自动触发预处理
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { parser } from 'stream-json'
import { pick } from 'stream-json/filters/Pick'
import { streamValues } from 'stream-json/streamers/StreamValues'
import { chain } from 'stream-chain'
import type { ParseProgress, Preprocessor } from '../types'
import { getFileSize, createProgress } from '../utils'

/** 预处理阈值：50MB */
const PREPROCESS_THRESHOLD = 50 * 1024 * 1024

/**
 * 获取临时目录
 */
function getTempDir(): string {
  return path.join(os.tmpdir(), 'chatlab')
}

/**
 * 确保目录存在
 */
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * 从字符串中提取 JSON 对象（处理嵌套和转义）
 */
function extractJsonObject(content: string, key: string): string | null {
  const searchStr = `"${key}":`
  const startIdx = content.indexOf(searchStr)
  if (startIdx === -1) return null

  let i = startIdx + searchStr.length
  while (i < content.length && /\s/.test(content[i])) i++

  if (content[i] !== '{') return null

  let braceDepth = 0
  let inString = false
  let escape = false
  const objStart = i

  for (; i < content.length; i++) {
    const char = content[i]

    if (escape) {
      escape = false
      continue
    }

    if (char === '\\' && inString) {
      escape = true
      continue
    }

    if (char === '"') {
      inString = !inString
      continue
    }

    if (!inString) {
      if (char === '{') braceDepth++
      if (char === '}') {
        braceDepth--
        if (braceDepth === 0) {
          return content.slice(objStart, i + 1)
        }
      }
    }
  }

  return null
}

/**
 * 从文件末尾读取 avatars 对象
 */
function readAvatarsFromFile(filePath: string): string | null {
  try {
    const stats = fs.statSync(filePath)
    const tailSize = Math.min(stats.size, 5000000) // 最多读取 5MB
    const fd = fs.openSync(filePath, 'r')
    const buffer = Buffer.alloc(tailSize)
    fs.readSync(fd, buffer, 0, tailSize, stats.size - tailSize)
    fs.closeSync(fd)

    const tailContent = buffer.toString('utf-8')
    return extractJsonObject(tailContent, 'avatars')
  } catch {
    return null
  }
}

/**
 * QQ JSON 消息的精简结构
 */
interface SlimQQMessage {
  id?: string
  messageId?: string
  timestamp: number | string
  sender: {
    uid?: string
    uin?: string
    name: string
  }
  type?: string
  messageType?: number
  content: {
    text: string
    elements?: Array<{ type: string }>
    resources?: Array<{ type: string }>
    emojis?: Array<{ type: string }>
  }
  recalled?: boolean
  isRecalled?: boolean
  system?: boolean
  isSystemMessage?: boolean
  rawMessage?: {
    sendNickName?: string
    sendMemberName?: string
    senderUin?: string
    senderUid?: string
  }
}

/**
 * 精简 QQ JSON 消息对象
 */
function slimMessage(msg: Record<string, unknown>): SlimQQMessage {
  const sender = msg.sender as { uin?: string; uid?: string; name?: string } | undefined
  const content = msg.content as Record<string, unknown> | undefined
  const rawMessage = msg.rawMessage as Record<string, unknown> | undefined

  const slimContent: SlimQQMessage['content'] = {
    text: (content?.text as string) || '',
  }

  if (content?.elements && Array.isArray(content.elements)) {
    slimContent.elements = (content.elements as Array<{ type: string }>).map((e) => ({
      type: e.type,
    }))
  }

  if (content?.resources && Array.isArray(content.resources)) {
    slimContent.resources = (content.resources as Array<{ type: string }>).map((r) => ({
      type: r.type,
    }))
  }

  if (content?.emojis && Array.isArray(content.emojis)) {
    slimContent.emojis = (content.emojis as Array<{ type: string }>).map((e) => ({
      type: e.type,
    }))
  }

  const slimMsg: SlimQQMessage = {
    timestamp: msg.timestamp as number | string,
    sender: { name: sender?.name || '' },
    content: slimContent,
  }

  // 旧格式字段
  if (msg.id) slimMsg.id = msg.id as string
  if (msg.type) slimMsg.type = msg.type as string
  if (msg.recalled) slimMsg.recalled = msg.recalled as boolean
  if (msg.system) slimMsg.system = msg.system as boolean

  // V4 新格式字段
  if (msg.messageId) slimMsg.messageId = msg.messageId as string
  if (msg.messageType !== undefined) slimMsg.messageType = msg.messageType as number
  if (msg.isRecalled) slimMsg.isRecalled = msg.isRecalled as boolean
  if (msg.isSystemMessage) slimMsg.isSystemMessage = msg.isSystemMessage as boolean

  // sender 字段
  if (sender?.uin) slimMsg.sender.uin = sender.uin
  if (sender?.uid) slimMsg.sender.uid = sender.uid

  // V4 新增：保留 rawMessage 中的关键名字字段
  if (rawMessage) {
    slimMsg.rawMessage = {}
    if (rawMessage.sendNickName) slimMsg.rawMessage.sendNickName = rawMessage.sendNickName as string
    if (rawMessage.sendMemberName) slimMsg.rawMessage.sendMemberName = rawMessage.sendMemberName as string
    if (rawMessage.senderUin) slimMsg.rawMessage.senderUin = rawMessage.senderUin as string
    if (rawMessage.senderUid) slimMsg.rawMessage.senderUid = rawMessage.senderUid as string
  }

  return slimMsg
}

/**
 * 预处理 QQ JSON 文件
 */
async function preprocessQQJson(inputPath: string, onProgress?: (progress: ParseProgress) => void): Promise<string> {
  const totalBytes = getFileSize(inputPath)
  let bytesRead = 0
  let messagesProcessed = 0

  const tempDir = getTempDir()
  ensureDir(tempDir)
  const outputFilename = `slim_${Date.now()}_${path.basename(inputPath)}`
  const outputPath = path.join(tempDir, outputFilename)

  onProgress?.(createProgress('parsing', 0, totalBytes, 0, ''))

  // 先从原文件读取 avatars（因为它在文件末尾，消息处理时可能无法访问）
  const avatarsStr = readAvatarsFromFile(inputPath)

  return new Promise((resolve, reject) => {
    const headChunks: string[] = []
    let headSize = 0
    const maxHeadSize = 100000

    const headStream = fs.createReadStream(inputPath, { encoding: 'utf-8' })
    let chatInfo: Record<string, unknown> = { name: '未知群聊', type: 'group' }
    let metadata: Record<string, unknown> | undefined
    let statistics: Record<string, unknown> | undefined

    headStream.on('data', (chunk: string | Buffer) => {
      const str = typeof chunk === 'string' ? chunk : chunk.toString('utf-8')
      if (headSize < maxHeadSize) {
        headChunks.push(str)
        headSize += str.length
      } else {
        headStream.destroy()
      }
    })

    headStream.on('close', () => {
      const headContent = headChunks.join('')

      try {
        const chatInfoMatch = headContent.match(/"chatInfo"\s*:\s*(\{[^}]+\})/)
        if (chatInfoMatch) {
          chatInfo = JSON.parse(chatInfoMatch[1])
        }
      } catch {
        // 使用默认值
      }

      try {
        const metadataMatch = headContent.match(/"metadata"\s*:\s*(\{[^}]+\})/)
        if (metadataMatch) {
          metadata = JSON.parse(metadataMatch[1])
        }
      } catch {
        // 忽略
      }

      try {
        const statisticsMatch = headContent.match(/"statistics"\s*:\s*(\{[\s\S]*?\})\s*,\s*"messages"/)
        if (statisticsMatch) {
          statistics = JSON.parse(statisticsMatch[1])
        }
      } catch {
        // 解析失败时忽略
      }

      onProgress?.(createProgress('parsing', 0, totalBytes, 0, ''))

      const readStream = fs.createReadStream(inputPath, { encoding: 'utf-8' })
      const writeStream = fs.createWriteStream(outputPath, { encoding: 'utf-8' })

      readStream.on('data', (chunk: string | Buffer) => {
        bytesRead += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
      })

      const header = { metadata, chatInfo, statistics, messages: [] }
      const headerJson = JSON.stringify(header)
      // 移除最后的 ]} 保留 [
      writeStream.write(headerJson.slice(0, -2) + '\n')

      let isFirstMessage = true

      const pipeline = chain([readStream, parser(), pick({ filter: /^messages\.\d+$/ }), streamValues()])

      pipeline.on('data', ({ value }: { value: Record<string, unknown> }) => {
        const slimMsg = slimMessage(value)
        const msgJson = JSON.stringify(slimMsg)

        if (isFirstMessage) {
          writeStream.write(msgJson)
          isFirstMessage = false
        } else {
          writeStream.write(',\n' + msgJson)
        }

        messagesProcessed++

        if (messagesProcessed % 10000 === 0) {
          onProgress?.(
            createProgress(
              'parsing',
              bytesRead,
              totalBytes,
              messagesProcessed,
              `预处理：已精简 ${messagesProcessed} 条消息...`
            )
          )
        }
      })

      pipeline.on('end', () => {
        // 关闭 messages 数组
        writeStream.write('\n]')

        // 添加 avatars 对象（如果存在）
        if (avatarsStr) {
          writeStream.write(',"avatars":' + avatarsStr)
        }

        // 关闭 JSON 对象
        writeStream.write('}')
        writeStream.end()

        writeStream.on('finish', () => {
          onProgress?.(createProgress('done', totalBytes, totalBytes, messagesProcessed, ''))
          resolve(outputPath)
        })
      })

      pipeline.on('error', (err) => {
        writeStream.destroy()
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath)
        }
        onProgress?.(createProgress('error', bytesRead, totalBytes, messagesProcessed, err.message))
        reject(err)
      })
    })

    headStream.on('error', reject)
  })
}

/**
 * 清理临时文件
 */
function cleanupTempFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath) && filePath.includes(getTempDir())) {
      fs.unlinkSync(filePath)
    }
  } catch {
    // 忽略清理错误
  }
}

/**
 * QQ Chat Exporter 预处理器
 */
export const qqPreprocessor: Preprocessor = {
  needsPreprocess(_filePath: string, fileSize: number): boolean {
    return fileSize > PREPROCESS_THRESHOLD
  },

  preprocess: preprocessQQJson,

  cleanup: cleanupTempFile,
}
