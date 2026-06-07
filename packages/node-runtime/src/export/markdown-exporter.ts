/**
 * Markdown export engine (platform-agnostic).
 *
 * Extracted from electron/main/worker/query/session/export.ts.
 * Exports filtered chat messages to Markdown format via a writer abstraction.
 * Supports condition-based filtering (keyword/sender/time) and session-based export.
 */

import type { DatabaseAdapter } from '@openchatlab/core'

// ==================== Public interfaces ====================

export interface ExportFilterParams {
  sessionId: string
  sessionName: string
  filterMode: 'condition' | 'session'
  keywords?: string[]
  timeFilter?: { startTs: number; endTs: number }
  senderIds?: number[]
  contextSize?: number
  segmentIds?: number[]
}

export interface ExportProgress {
  stage: 'preparing' | 'exporting' | 'done' | 'error'
  currentBlock: number
  totalBlocks: number
  percentage: number
  message: string
}

export type ExportProgressCallback = (progress: ExportProgress) => void

export interface ExportWriter {
  write(chunk: string): void
  end(): void
}

export interface ExportDeps {
  openDatabase(sessionId: string): DatabaseAdapter | null
  onProgress?: ExportProgressCallback
}

export interface ExportResult {
  success: boolean
  error?: string
  totalBlocks: number
  totalMessages: number
}

// ==================== Core export logic ====================

/**
 * Export filter results to Markdown via the provided writer.
 * Platform-agnostic: no filesystem or IPC dependency.
 */
export function exportFilterResultToMarkdown(
  params: ExportFilterParams,
  deps: ExportDeps,
  writer: ExportWriter
): ExportResult {
  const db = deps.openDatabase(params.sessionId)
  if (!db) {
    return { success: false, error: 'Cannot open database', totalBlocks: 0, totalMessages: 0 }
  }

  const progress = deps.onProgress

  try {
    writer.write(`# ${params.sessionName} - Chat Filter Results\n\n`)
    writer.write(`> Export time: ${new Date().toLocaleString()}\n\n`)

    writer.write(`## Filter Conditions\n\n`)
    if (params.filterMode === 'condition') {
      if (params.keywords && params.keywords.length > 0) {
        writer.write(`- Keywords: ${params.keywords.join(', ')}\n`)
      }
      if (params.timeFilter) {
        const start = new Date(params.timeFilter.startTs * 1000).toLocaleString()
        const end = new Date(params.timeFilter.endTs * 1000).toLocaleString()
        writer.write(`- Time range: ${start} ~ ${end}\n`)
      }
      writer.write(`- Context: ±${params.contextSize || 10} messages\n`)
    } else {
      writer.write(`- Mode: session filter\n`)
      writer.write(`- Selected sessions: ${params.segmentIds?.length || 0}\n`)
    }
    writer.write('\n')

    let totalMessages = 0
    let blockIndex = 0

    if (params.filterMode === 'condition') {
      const result = exportConditionMode(db, params, writer, progress)
      totalMessages = result.totalMessages
      blockIndex = result.blockIndex
    } else {
      const result = exportSessionMode(db, params, writer, progress)
      totalMessages = result.totalMessages
      blockIndex = result.blockIndex
    }

    writer.end()

    progress?.({
      stage: 'done',
      currentBlock: blockIndex,
      totalBlocks: blockIndex,
      percentage: 100,
      message: `Export complete, ${blockIndex} blocks`,
    })

    return { success: true, totalBlocks: blockIndex, totalMessages }
  } catch (error) {
    progress?.({
      stage: 'error',
      currentBlock: 0,
      totalBlocks: 0,
      percentage: 0,
      message: `Export failed: ${String(error)}`,
    })
    return { success: false, error: String(error), totalBlocks: 0, totalMessages: 0 }
  }
}

// ==================== Condition mode ====================

function exportConditionMode(
  db: DatabaseAdapter,
  params: ExportFilterParams,
  writer: ExportWriter,
  progress?: ExportProgressCallback
): { totalMessages: number; blockIndex: number } {
  const contextSize = params.contextSize || 10

  const lightweightSql = `
    SELECT id, ts, sender_id as senderId, content
    FROM message
    ${params.timeFilter ? 'WHERE ts >= ? AND ts <= ?' : ''}
    ORDER BY ts ASC, id ASC
  `
  const sqlParams: unknown[] = []
  if (params.timeFilter) {
    sqlParams.push(params.timeFilter.startTs, params.timeFilter.endTs)
  }

  const hitIndexes: number[] = []
  let msgIndex = 0
  const stmt = db.prepare(lightweightSql)
  const rows = stmt.all(...sqlParams) as Array<{
    id: number
    ts: number
    senderId: number
    content: string | null
  }>

  for (const row of rows) {
    let isHit = true
    if (params.keywords && params.keywords.length > 0) {
      const content = (row.content || '').toLowerCase()
      isHit = params.keywords.some((kw) => content.includes(kw.toLowerCase()))
    }
    if (isHit && params.senderIds && params.senderIds.length > 0) {
      isHit = params.senderIds.includes(row.senderId)
    }
    if (isHit) hitIndexes.push(msgIndex)
    msgIndex++
  }

  const totalHits = hitIndexes.length

  progress?.({
    stage: 'preparing',
    currentBlock: 0,
    totalBlocks: 0,
    percentage: 10,
    message: `Analyzing: found ${totalHits} matching messages...`,
  })

  if (hitIndexes.length === 0) {
    writer.write(`## Statistics\n\n- No matches\n`)
    writer.end()
    return { totalMessages: 0, blockIndex: 0 }
  }

  const totalMsgCount = msgIndex
  const ranges: Array<{ start: number; end: number; hitIndexes: number[] }> = []
  for (const hitIdx of hitIndexes) {
    const start = Math.max(0, hitIdx - contextSize)
    const end = Math.min(totalMsgCount - 1, hitIdx + contextSize)
    if (ranges.length > 0) {
      const last = ranges[ranges.length - 1]
      if (start <= last.end + 1) {
        last.end = Math.max(last.end, end)
        last.hitIndexes.push(hitIdx)
        continue
      }
    }
    ranges.push({ start, end, hitIndexes: [hitIdx] })
  }

  const totalBlocks = ranges.length
  progress?.({
    stage: 'exporting',
    currentBlock: 0,
    totalBlocks,
    percentage: 15,
    message: `Exporting ${totalBlocks} conversation blocks...`,
  })

  writer.write(`## Statistics\n\n- Blocks: ${totalBlocks}\n- Hits: ${totalHits}\n\n`)
  writer.write(`## Conversation Content\n\n`)

  let totalMessages = 0
  let blockIndex = 0

  for (const range of ranges) {
    blockIndex++
    progress?.({
      stage: 'exporting',
      currentBlock: blockIndex,
      totalBlocks,
      percentage: Math.round(15 + ((blockIndex - 1) / totalBlocks) * 80),
      message: `Exporting block ${blockIndex}/${totalBlocks}...`,
    })

    const blockSql = `
      SELECT msg.id, msg.ts,
             COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
             msg.content
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${params.timeFilter ? 'WHERE msg.ts >= ? AND msg.ts <= ?' : ''}
      ORDER BY msg.ts ASC, msg.id ASC
      LIMIT ? OFFSET ?
    `
    const blockParams: unknown[] = []
    if (params.timeFilter) {
      blockParams.push(params.timeFilter.startTs, params.timeFilter.endTs)
    }
    blockParams.push(range.end - range.start + 1, range.start)

    const messages = db.prepare(blockSql).all(...blockParams) as Array<{
      id: number
      ts: number
      senderName: string
      content: string | null
    }>

    if (messages.length === 0) continue

    const hitIndexSet = new Set(range.hitIndexes.map((idx) => idx - range.start))
    const startTime = new Date(messages[0].ts * 1000).toLocaleString()
    const endTime = new Date(messages[messages.length - 1].ts * 1000).toLocaleString()
    writer.write(`### Block ${blockIndex} (${startTime} ~ ${endTime})\n\n`)

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      const time = new Date(msg.ts * 1000).toLocaleTimeString()
      const hitMark = hitIndexSet.has(i) ? ' ⭐' : ''
      writer.write(`${time} ${msg.senderName}${hitMark}: ${msg.content || '[non-text message]'}\n`)
      totalMessages++
    }
    writer.write('\n')
  }

  return { totalMessages, blockIndex }
}

// ==================== Session mode ====================

function exportSessionMode(
  db: DatabaseAdapter,
  params: ExportFilterParams,
  writer: ExportWriter,
  progress?: ExportProgressCallback
): { totalMessages: number; blockIndex: number } {
  if (!params.segmentIds || params.segmentIds.length === 0) {
    writer.write(`## Statistics\n\n- No sessions selected\n`)
    writer.end()
    return { totalMessages: 0, blockIndex: 0 }
  }

  progress?.({
    stage: 'preparing',
    currentBlock: 0,
    totalBlocks: params.segmentIds.length,
    percentage: 10,
    message: `Preparing to export ${params.segmentIds.length} sessions...`,
  })

  const sessionsSql = `
    SELECT id, start_ts as startTs, end_ts as endTs
    FROM segment
    WHERE id IN (${params.segmentIds.map(() => '?').join(',')})
    ORDER BY start_ts ASC
  `
  const sessions = db.prepare(sessionsSql).all(...params.segmentIds) as Array<{
    id: number
    startTs: number
    endTs: number
  }>

  const totalBlocks = sessions.length
  writer.write(`## Statistics\n\n- Blocks: ${totalBlocks}\n\n`)
  writer.write(`## Conversation Content\n\n`)

  const messagesSql = `
    SELECT msg.id,
           COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
           msg.content,
           msg.ts as timestamp
    FROM message_context mc
    JOIN message msg ON msg.id = mc.message_id
    JOIN member m ON msg.sender_id = m.id
    WHERE mc.segment_id = ?
    ORDER BY msg.ts ASC
  `

  let totalMessages = 0
  let blockIndex = 0

  for (const session of sessions) {
    blockIndex++
    progress?.({
      stage: 'exporting',
      currentBlock: blockIndex,
      totalBlocks,
      percentage: Math.round(15 + ((blockIndex - 1) / totalBlocks) * 80),
      message: `Exporting session ${blockIndex}/${totalBlocks}...`,
    })

    const messages = db.prepare(messagesSql).all(session.id) as Array<{
      id: number
      senderName: string
      content: string | null
      timestamp: number
    }>

    if (messages.length === 0) continue

    const startTime = new Date(session.startTs * 1000).toLocaleString()
    const endTime = new Date(session.endTs * 1000).toLocaleString()
    writer.write(`### Block ${blockIndex} (${startTime} ~ ${endTime})\n\n`)

    for (const msg of messages) {
      const time = new Date(msg.timestamp * 1000).toLocaleTimeString()
      writer.write(`${time} ${msg.senderName}: ${msg.content || '[non-text message]'}\n`)
      totalMessages++
    }
    writer.write('\n')
  }

  return { totalMessages, blockIndex }
}
