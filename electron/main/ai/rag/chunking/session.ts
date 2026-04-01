/**
 * 会话级切片实现
 *
 * 利用现有的 chat_session 表，将会话作为切片单位
 */

import Database from 'better-sqlite3'
import type { Chunk, ChunkMetadata } from './types'
import type { SessionMessage, SessionInfo, ChunkingOptions } from './types'
import { INVALID_MESSAGE_TYPES, INVALID_TEXT_PATTERNS } from './types'
import { aiLogger as logger } from '../../logger'

/**
 * 切片长度限制
 * 大多数 Embedding 模型的上下文限制在 8192 tokens
 * 中文约 1.5-2 字符/token，英文约 4 字符/token
 * 保守估计：使用 2000 字符作为单个切片的最大长度
 */
const MAX_CHUNK_CHARS = 2000

/**
 * 子切片重叠字符数（保持上下文连贯性）
 */
const CHUNK_OVERLAP_CHARS = 200

/**
 * 格式化时间范围
 */
function formatTimeRange(startTs: number, endTs: number): string {
  const startDate = new Date(startTs)
  const endDate = new Date(endTs)

  const formatDate = (d: Date) => {
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hour = String(d.getHours()).padStart(2, '0')
    const minute = String(d.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day} ${hour}:${minute}`
  }

  return `${formatDate(startDate)} ~ ${formatDate(endDate)}`
}

/**
 * 过滤有效的文本消息
 * ⭐ 提高 Embedding 质量的关键步骤
 */
function filterValidMessages(messages: SessionMessage[]): SessionMessage[] {
  return messages.filter((m) => {
    // 过滤无效消息类型
    if (m.type !== undefined && INVALID_MESSAGE_TYPES.includes(m.type as (typeof INVALID_MESSAGE_TYPES)[number])) {
      return false
    }

    // 过滤空内容
    if (!m.content || m.content.trim().length === 0) {
      return false
    }

    // 过滤占位符文本
    const content = m.content.trim()
    for (const pattern of INVALID_TEXT_PATTERNS) {
      if (content.includes(pattern)) {
        return false
      }
    }

    return true
  })
}

/**
 * 格式化会话切片内容
 *
 * 示例输出：
 * "[2024-01-15 14:30 ~ 15:20] 参与者：张三、李四
 *  张三: 今天天气不错
 *  李四: 是的，很适合出门
 *  张三: 下午一起去公园？"
 */
export function formatSessionChunk(
  session: SessionInfo,
  messages: SessionMessage[],
  filterInvalid: boolean = true
): string {
  const timeRange = formatTimeRange(session.startTs, session.endTs)

  // ⭐ 过滤无效消息，只保留有语义价值的文本
  const validMessages = filterInvalid ? filterValidMessages(messages) : messages

  // 如果过滤后没有有效消息，返回空字符串
  if (validMessages.length === 0) {
    return ''
  }

  const participants = [...new Set(validMessages.map((m) => m.senderName))].join('、')

  const content = validMessages.map((m) => `${m.senderName}: ${m.content}`).join('\n')

  return `[${timeRange}] 参与者：${participants}\n${content}`
}

/**
 * 将超长内容拆分为多个子切片
 *
 * @param content 原始内容
 * @param maxChars 单个切片最大字符数
 * @param overlapChars 重叠字符数
 * @returns 子切片数组
 */
function splitIntoSubChunks(
  content: string,
  maxChars: number = MAX_CHUNK_CHARS,
  overlapChars: number = CHUNK_OVERLAP_CHARS
): string[] {
  if (content.length <= maxChars) {
    return [content]
  }

  const chunks: string[] = []
  const lines = content.split('\n')

  let currentChunk = ''
  let overlapBuffer = '' // 用于保存重叠部分

  for (const line of lines) {
    // 如果单行就超过限制，需要进一步拆分
    if (line.length > maxChars) {
      // 先保存当前累积的内容
      if (currentChunk) {
        chunks.push(currentChunk)
        // 取最后几行作为重叠
        const lines = currentChunk.split('\n')
        overlapBuffer = lines.slice(-3).join('\n').slice(-overlapChars)
        currentChunk = ''
      }

      // 按字符拆分超长行
      let remaining = line
      while (remaining.length > 0) {
        const part = remaining.slice(0, maxChars - overlapBuffer.length)
        chunks.push(overlapBuffer + part)
        overlapBuffer = part.slice(-overlapChars)
        remaining = remaining.slice(maxChars - overlapBuffer.length)
      }
      continue
    }

    // 检查添加这行后是否会超过限制
    const newLength = currentChunk.length + (currentChunk ? 1 : 0) + line.length

    if (newLength > maxChars) {
      // 保存当前切片
      if (currentChunk) {
        chunks.push(currentChunk)
        // 取最后几行作为重叠
        const lines = currentChunk.split('\n')
        overlapBuffer = lines.slice(-3).join('\n').slice(-overlapChars)
      }
      // 开始新切片（带重叠）
      currentChunk = overlapBuffer ? overlapBuffer + '\n' + line : line
    } else {
      // 继续累积
      currentChunk = currentChunk ? currentChunk + '\n' + line : line
    }
  }

  // 保存最后一个切片
  if (currentChunk) {
    chunks.push(currentChunk)
  }

  return chunks
}

/**
 * 从数据库获取会话列表
 */
function getSessionsFromDb(db: Database.Database, options: ChunkingOptions): SessionInfo[] {
  const { limit = 50, timeFilter } = options

  let sql = `
    SELECT
      id,
      start_ts as startTs,
      end_ts as endTs,
      message_count as messageCount
    FROM chat_session
  `

  const params: (number | undefined)[] = []

  // 时间过滤
  if (timeFilter) {
    sql += ' WHERE start_ts >= ? AND end_ts <= ?'
    params.push(timeFilter.startTs, timeFilter.endTs)
  }

  // 按时间倒序，取最近的会话
  sql += ' ORDER BY start_ts DESC LIMIT ?'
  params.push(limit)

  const sessions = db.prepare(sql).all(...params) as SessionInfo[]

  // 按时间正序返回（便于阅读）
  return sessions.reverse()
}

/**
 * 获取会话的消息
 */
function getSessionMessagesFromDb(db: Database.Database, sessionId: number, limit: number = 500): SessionMessage[] {
  const sql = `
    SELECT
      m.id,
      COALESCE(mb.group_nickname, mb.account_name, mb.platform_id) as senderName,
      m.content,
      m.ts as timestamp,
      m.type
    FROM message_context mc
    JOIN message m ON m.id = mc.message_id
    JOIN member mb ON mb.id = m.sender_id
    WHERE mc.session_id = ?
    ORDER BY m.ts ASC
    LIMIT ?
  `

  return db.prepare(sql).all(sessionId, limit) as SessionMessage[]
}

/**
 * 获取会话级切片
 *
 * @param dbPath 数据库路径
 * @param options 切片选项
 * @returns 切片列表
 */
export function getSessionChunks(dbPath: string, options: ChunkingOptions = {}): Chunk[] {
  const { filterInvalid = true, maxChunkChars = MAX_CHUNK_CHARS } = options

  let db: Database.Database | null = null

  try {
    db = new Database(dbPath, { readonly: true })

    // 1. 获取会话列表
    const sessions = getSessionsFromDb(db, options)

    if (sessions.length === 0) {
      return []
    }

    // 2. 为每个会话生成切片
    const chunks: Chunk[] = []

    for (const session of sessions) {
      // 获取会话消息
      const messages = getSessionMessagesFromDb(db, session.id)

      // 格式化切片内容
      const content = formatSessionChunk(session, messages, filterInvalid)

      // 跳过空内容的切片
      if (!content) {
        continue
      }

      // 计算参与者（使用过滤后的消息）
      const validMessages = filterInvalid ? filterValidMessages(messages) : messages
      const participants = [...new Set(validMessages.map((m) => m.senderName))]

      const baseMetadata: ChunkMetadata = {
        sessionId: session.id,
        startTs: session.startTs,
        endTs: session.endTs,
        messageCount: validMessages.length,
        participants,
      }

      // ⭐ 检查是否需要拆分为子切片
      if (content.length <= maxChunkChars) {
        // 内容在限制内，直接添加
        chunks.push({
          id: `session_${session.id}`,
          type: 'session',
          content,
          metadata: baseMetadata,
        })
      } else {
        // 内容超长，拆分为子切片
        const subChunks = splitIntoSubChunks(content, maxChunkChars)

        for (let i = 0; i < subChunks.length; i++) {
          chunks.push({
            id: `session_${session.id}_part${i + 1}`,
            type: 'session',
            content: subChunks[i],
            metadata: {
              ...baseMetadata,
              subChunkIndex: i,
              totalSubChunks: subChunks.length,
            },
          })
        }
      }
    }

    return chunks
  } catch (error) {
    logger.error('Chunking', 'Failed to get session chunks', error)
    return []
  } finally {
    if (db) {
      db.close()
    }
  }
}

/**
 * 获取单个会话的切片
 */
export function getSessionChunk(dbPath: string, sessionId: number): Chunk | null {
  let db: Database.Database | null = null

  try {
    db = new Database(dbPath, { readonly: true })

    // 获取会话信息
    const session = db
      .prepare(
        `
      SELECT
        id,
        start_ts as startTs,
        end_ts as endTs,
        message_count as messageCount
      FROM chat_session
      WHERE id = ?
    `
      )
      .get(sessionId) as SessionInfo | undefined

    if (!session) {
      return null
    }

    // 获取消息
    const messages = getSessionMessagesFromDb(db, sessionId)

    // 格式化内容
    const content = formatSessionChunk(session, messages, true)

    if (!content) {
      return null
    }

    // 参与者
    const validMessages = filterValidMessages(messages)
    const participants = [...new Set(validMessages.map((m) => m.senderName))]

    return {
      id: `session_${session.id}`,
      type: 'session',
      content,
      metadata: {
        sessionId: session.id,
        startTs: session.startTs,
        endTs: session.endTs,
        messageCount: validMessages.length,
        participants,
      },
    }
  } catch (error) {
    logger.error('Chunking', 'Failed to get single session chunk', error)
    return null
  } finally {
    if (db) {
      db.close()
    }
  }
}
