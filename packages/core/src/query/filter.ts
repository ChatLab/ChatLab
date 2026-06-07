/**
 * Message filter with context expansion and pagination.
 *
 * Two-phase query architecture:
 * 1. Lightweight pass: fetch id/ts/senderId/content to identify hits
 * 2. Full pass: load complete message data only for the current page's ranges
 */

import type { DatabaseAdapter } from '../interfaces/database-adapter'
import { FULL_MSG_COLUMNS, FULL_MSG_FROM, mapMessageRow, type FullMessageRow, type MappedMessage } from './message-sql'

// ==================== Types ====================

export interface FilterMessage extends MappedMessage {
  isHit: boolean
}

export interface ContextBlock {
  startTs: number
  endTs: number
  messages: FilterMessage[]
  hitCount: number
}

export interface FilterStats {
  totalMessages: number
  hitMessages: number
  totalChars: number
}

export interface PaginationInfo {
  page: number
  pageSize: number
  totalBlocks: number
  totalHits: number
  hasMore: boolean
}

export interface FilterResultWithPagination {
  blocks: ContextBlock[]
  stats: FilterStats
  pagination: PaginationInfo
}

export interface FilterOptions {
  keywords?: string[]
  timeFilter?: { startTs: number; endTs: number }
  senderIds?: number[]
  contextSize?: number
  page?: number
  pageSize?: number
}

// ==================== Helpers ====================

function emptyResult(page: number, pageSize: number): FilterResultWithPagination {
  return {
    blocks: [],
    stats: { totalMessages: 0, hitMessages: 0, totalChars: 0 },
    pagination: { page, pageSize, totalBlocks: 0, totalHits: 0, hasMore: false },
  }
}

// ==================== Core filter algorithm ====================

/**
 * Filter messages by keyword/sender/time with surrounding context, paginated by blocks.
 */
export function filterMessagesWithContext(
  db: DatabaseAdapter,
  options: FilterOptions = {}
): FilterResultWithPagination {
  const { keywords, timeFilter, senderIds, contextSize = 10, page = 1, pageSize = 50 } = options

  // Phase 1: lightweight scan
  const lightSql = `
    SELECT id, ts, sender_id as senderId, content
    FROM message
    ${timeFilter ? 'WHERE ts >= ? AND ts <= ?' : ''}
    ORDER BY ts ASC, id ASC
  `
  const params: unknown[] = []
  if (timeFilter) {
    params.push(timeFilter.startTs, timeFilter.endTs)
  }

  const lightRows = db.prepare(lightSql).all(...params) as Array<{
    id: number
    ts: number
    senderId: number
    content: string | null
  }>

  const hitIndexes: number[] = []
  for (let i = 0; i < lightRows.length; i++) {
    const row = lightRows[i]
    let isHit = true

    if (keywords && keywords.length > 0) {
      const content = (row.content || '').toLowerCase()
      isHit = keywords.some((kw) => content.includes(kw.toLowerCase()))
    }
    if (isHit && senderIds && senderIds.length > 0) {
      isHit = senderIds.includes(row.senderId)
    }
    if (isHit) {
      hitIndexes.push(i)
    }
  }

  if (hitIndexes.length === 0) {
    return emptyResult(page, pageSize)
  }

  // Merge overlapping context ranges
  const ranges: Array<{ start: number; end: number; hitIndexes: number[] }> = []
  for (const hitIndex of hitIndexes) {
    const start = Math.max(0, hitIndex - contextSize)
    const end = Math.min(lightRows.length - 1, hitIndex + contextSize)

    if (ranges.length > 0) {
      const lastRange = ranges[ranges.length - 1]
      if (start <= lastRange.end + 1) {
        lastRange.end = Math.max(lastRange.end, end)
        lastRange.hitIndexes.push(hitIndex)
        continue
      }
    }
    ranges.push({ start, end, hitIndexes: [hitIndex] })
  }

  const totalBlocks = ranges.length
  const totalHits = hitIndexes.length

  // Paginate blocks
  const startIdx = (page - 1) * pageSize
  const endIdx = Math.min(startIdx + pageSize, totalBlocks)
  const pageRanges = ranges.slice(startIdx, endIdx)
  const hasMore = endIdx < totalBlocks

  if (pageRanges.length === 0) {
    return {
      blocks: [],
      stats: { totalMessages: 0, hitMessages: totalHits, totalChars: 0 },
      pagination: { page, pageSize, totalBlocks, totalHits, hasMore: false },
    }
  }

  // Phase 2: load full messages for current page ranges
  const blocks: ContextBlock[] = []
  let totalMessages = 0
  let totalChars = 0

  for (const range of pageRanges) {
    const blockSql = `
      SELECT ${FULL_MSG_COLUMNS}
      ${FULL_MSG_FROM}
      ${timeFilter ? 'WHERE msg.ts >= ? AND msg.ts <= ?' : ''}
      ORDER BY msg.ts ASC, msg.id ASC
      LIMIT ? OFFSET ?
    `
    const blockParams: unknown[] = []
    if (timeFilter) {
      blockParams.push(timeFilter.startTs, timeFilter.endTs)
    }
    blockParams.push(range.end - range.start + 1, range.start)

    const rows = db.prepare(blockSql).all(...blockParams) as unknown as FullMessageRow[]
    const mapped = rows.map(mapMessageRow)

    const hitIndexSet = new Set(range.hitIndexes.map((idx) => idx - range.start))
    const blockMessages: FilterMessage[] = mapped.map((msg, i) => ({
      ...msg,
      isHit: hitIndexSet.has(i),
    }))

    for (const msg of mapped) {
      totalChars += msg.content.length
    }

    if (blockMessages.length > 0) {
      blocks.push({
        startTs: blockMessages[0].timestamp,
        endTs: blockMessages[blockMessages.length - 1].timestamp,
        messages: blockMessages,
        hitCount: range.hitIndexes.length,
      })
      totalMessages += blockMessages.length
    }
  }

  let estimatedTotalChars = totalChars
  if (page === 1 && totalBlocks > pageSize && blocks.length > 0) {
    const avgCharsPerBlock = totalChars / blocks.length
    estimatedTotalChars = Math.round(avgCharsPerBlock * totalBlocks)
  }

  return {
    blocks,
    stats: {
      totalMessages: page === 1 ? totalMessages : 0,
      hitMessages: totalHits,
      totalChars: page === 1 ? (totalBlocks > pageSize ? estimatedTotalChars : totalChars) : 0,
    },
    pagination: { page, pageSize, totalBlocks, totalHits, hasMore },
  }
}

/**
 * Get messages from multiple chat sessions, paginated by session blocks.
 */
export function getMultipleSessionsMessages(
  db: DatabaseAdapter,
  segmentIds: number[],
  page: number = 1,
  pageSize: number = 50
): FilterResultWithPagination {
  if (segmentIds.length === 0) {
    return emptyResult(page, pageSize)
  }

  const sessionsSql = `
    SELECT id, start_ts as startTs, end_ts as endTs, message_count as messageCount
    FROM segment
    WHERE id IN (${segmentIds.map(() => '?').join(',')})
    ORDER BY start_ts ASC
  `
  const allSessions = db.prepare(sessionsSql).all(...segmentIds) as Array<{
    id: number
    startTs: number
    endTs: number
    messageCount: number
  }>

  const totalBlocks = allSessions.length
  const startIdx = (page - 1) * pageSize
  const endIdx = Math.min(startIdx + pageSize, totalBlocks)
  const pageSessions = allSessions.slice(startIdx, endIdx)
  const hasMore = endIdx < totalBlocks

  if (pageSessions.length === 0) {
    return {
      blocks: [],
      stats: { totalMessages: 0, hitMessages: 0, totalChars: 0 },
      pagination: { page, pageSize, totalBlocks, totalHits: 0, hasMore: false },
    }
  }

  const blocks: ContextBlock[] = []
  let totalMessages = 0
  let totalChars = 0

  const messagesSql = `
    SELECT ${FULL_MSG_COLUMNS}
    FROM message_context mc
    JOIN message msg ON msg.id = mc.message_id
    JOIN member m ON msg.sender_id = m.id
    LEFT JOIN message reply_msg ON msg.reply_to_message_id = reply_msg.platform_message_id
    LEFT JOIN member reply_m ON reply_msg.sender_id = reply_m.id
    WHERE mc.segment_id = ?
    ORDER BY msg.ts ASC
  `

  for (const session of pageSessions) {
    const rows = db.prepare(messagesSql).all(session.id) as unknown as FullMessageRow[]
    const mapped = rows.map(mapMessageRow)

    const blockMessages: FilterMessage[] = mapped.map((msg) => ({
      ...msg,
      isHit: false,
    }))

    for (const msg of mapped) {
      totalChars += msg.content.length
    }

    blocks.push({
      startTs: session.startTs,
      endTs: session.endTs,
      messages: blockMessages,
      hitCount: 0,
    })
    totalMessages += rows.length
  }

  return {
    blocks,
    stats: {
      totalMessages: page === 1 ? totalMessages : 0,
      hitMessages: 0,
      totalChars: page === 1 ? totalChars : 0,
    },
    pagination: { page, pageSize, totalBlocks, totalHits: 0, hasMore },
  }
}
