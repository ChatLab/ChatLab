/**
 * Session-level chunking implementation (platform-agnostic)
 *
 * Uses better-sqlite3 directly (node-runtime already depends on it).
 */

import Database from 'better-sqlite3'
import type { Chunk, ChunkMetadata } from './types'
import type { SessionMessage, SessionInfo, ChunkingOptions } from './types'
import { INVALID_MESSAGE_TYPES, INVALID_TEXT_PATTERNS } from './types'
import type { RagLogger } from '../types'
import { getNoopLogger } from '../types'

const MAX_CHUNK_CHARS = 2000
const CHUNK_OVERLAP_CHARS = 200

let _logger: RagLogger = getNoopLogger()

export function initChunkingLogger(logger: RagLogger): void {
  _logger = logger
}

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

function filterValidMessages(messages: SessionMessage[]): SessionMessage[] {
  return messages.filter((m) => {
    if (m.type !== undefined && INVALID_MESSAGE_TYPES.includes(m.type as (typeof INVALID_MESSAGE_TYPES)[number])) {
      return false
    }

    if (!m.content || m.content.trim().length === 0) {
      return false
    }

    const content = m.content.trim()
    for (const pattern of INVALID_TEXT_PATTERNS) {
      if (content.includes(pattern)) {
        return false
      }
    }

    return true
  })
}

export function formatSessionChunk(
  session: SessionInfo,
  messages: SessionMessage[],
  filterInvalid: boolean = true
): string {
  const timeRange = formatTimeRange(session.startTs, session.endTs)

  const validMessages = filterInvalid ? filterValidMessages(messages) : messages

  if (validMessages.length === 0) {
    return ''
  }

  const participants = [...new Set(validMessages.map((m) => m.senderName))].join('、')

  const content = validMessages.map((m) => `${m.senderName}: ${m.content}`).join('\n')

  return `[${timeRange}] 参与者：${participants}\n${content}`
}

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
  let overlapBuffer = ''

  for (const line of lines) {
    if (line.length > maxChars) {
      if (currentChunk) {
        chunks.push(currentChunk)
        const chunkLines = currentChunk.split('\n')
        overlapBuffer = chunkLines.slice(-3).join('\n').slice(-overlapChars)
        currentChunk = ''
      }

      let remaining = line
      while (remaining.length > 0) {
        const part = remaining.slice(0, maxChars - overlapBuffer.length)
        chunks.push(overlapBuffer + part)
        overlapBuffer = part.slice(-overlapChars)
        remaining = remaining.slice(maxChars - overlapBuffer.length)
      }
      continue
    }

    const newLength = currentChunk.length + (currentChunk ? 1 : 0) + line.length

    if (newLength > maxChars) {
      if (currentChunk) {
        chunks.push(currentChunk)
        const chunkLines = currentChunk.split('\n')
        overlapBuffer = chunkLines.slice(-3).join('\n').slice(-overlapChars)
      }
      currentChunk = overlapBuffer ? overlapBuffer + '\n' + line : line
    } else {
      currentChunk = currentChunk ? currentChunk + '\n' + line : line
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk)
  }

  return chunks
}

function getSessionsFromDb(db: Database.Database, options: ChunkingOptions): SessionInfo[] {
  const { limit = 50, timeFilter } = options

  let sql = `
    SELECT
      id,
      start_ts as startTs,
      end_ts as endTs,
      message_count as messageCount
    FROM segment
  `

  const params: (number | undefined)[] = []

  if (timeFilter) {
    sql += ' WHERE start_ts >= ? AND end_ts <= ?'
    params.push(timeFilter.startTs, timeFilter.endTs)
  }

  sql += ' ORDER BY start_ts DESC LIMIT ?'
  params.push(limit)

  const sessions = db.prepare(sql).all(...params) as SessionInfo[]

  return sessions.reverse()
}

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
    WHERE mc.segment_id = ?
    ORDER BY m.ts ASC
    LIMIT ?
  `

  return db.prepare(sql).all(sessionId, limit) as SessionMessage[]
}

export function getSessionChunks(dbPath: string, options: ChunkingOptions = {}): Chunk[] {
  const { filterInvalid = true, maxChunkChars = MAX_CHUNK_CHARS } = options

  let db: Database.Database | null = null

  try {
    db = new Database(dbPath, { readonly: true })

    const sessions = getSessionsFromDb(db, options)

    if (sessions.length === 0) {
      return []
    }

    const chunks: Chunk[] = []

    for (const session of sessions) {
      const messages = getSessionMessagesFromDb(db, session.id)
      const content = formatSessionChunk(session, messages, filterInvalid)

      if (!content) {
        continue
      }

      const validMessages = filterInvalid ? filterValidMessages(messages) : messages
      const participants = [...new Set(validMessages.map((m) => m.senderName))]

      const baseMetadata: ChunkMetadata = {
        sessionId: session.id,
        startTs: session.startTs,
        endTs: session.endTs,
        messageCount: validMessages.length,
        participants,
      }

      if (content.length <= maxChunkChars) {
        chunks.push({
          id: `session_${session.id}`,
          type: 'session',
          content,
          metadata: baseMetadata,
        })
      } else {
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
    _logger.error('Chunking', 'Failed to get session chunks', error)
    return []
  } finally {
    if (db) {
      db.close()
    }
  }
}

export function getSessionChunk(dbPath: string, sessionId: number): Chunk | null {
  let db: Database.Database | null = null

  try {
    db = new Database(dbPath, { readonly: true })

    const session = db
      .prepare(
        `
      SELECT
        id,
        start_ts as startTs,
        end_ts as endTs,
        message_count as messageCount
      FROM segment
      WHERE id = ?
    `
      )
      .get(sessionId) as SessionInfo | undefined

    if (!session) {
      return null
    }

    const messages = getSessionMessagesFromDb(db, sessionId)

    const content = formatSessionChunk(session, messages, true)

    if (!content) {
      return null
    }

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
    _logger.error('Chunking', 'Failed to get single session chunk', error)
    return null
  } finally {
    if (db) {
      db.close()
    }
  }
}
