/**
 * Platform-agnostic incremental importer.
 *
 * Extracted from electron/main/worker/import/incrementalImport.ts.
 * Appends new messages to an existing session, using dual-path dedup:
 * platformMessageId (preferred) + content hash (fallback).
 *
 * Callers provide DatabaseAdapter + progress callback via dependency injection.
 */

import type { DatabaseAdapter } from '@openchatlab/core'
import { generateMessageKey, generateSessionIndex, generateIncrementalSessionIndex } from '@openchatlab/core'
import { streamParseFile, detectFormat, type ParseProgress } from '@openchatlab/parser'
import { insertFtsEntries, hasFtsTable } from '../fts'
import type { ImportProgressCallback } from './streaming-importer'

// ==================== Public interfaces ====================

export interface ImportOptions {
  metaUpdateMode?: 'patch' | 'none'
  memberUpdateMode?: 'upsert' | 'none'
}

export interface IncrementalAnalyzeResult {
  newMessageCount: number
  duplicateCount: number
  totalInFile: number
  error?: string
}

interface ErrorSample {
  index: number
  reason: string
  detail: string
}

export interface IncrementalImportResult {
  success: boolean
  newMessageCount: number
  error?: string
  batch?: {
    receivedCount: number
    writtenCount: number
    duplicateCount: number
    errorCount: number
    errorReasonCounts: Record<string, number>
    errorSample: ErrorSample[]
  }
  session?: {
    totalCount: number
    memberCount: number
    firstTimestamp: number
    lastTimestamp: number
  }
  updates?: {
    metaUpdated: boolean
    membersAdded: number
    membersUpdated: number
  }
}

export interface IncrementalImportDeps {
  /** Open existing session DB for read-only access (analyze) or read-write (import). */
  openDatabase(sessionId: string, readonly?: boolean): DatabaseAdapter
  onProgress: ImportProgressCallback
  /** Optional hook after incremental import (e.g. update overview cache). */
  postImportHook?: (db: DatabaseAdapter, sessionId: string) => void | Promise<void>
}

// ==================== Internal helpers ====================

function loadExistingDedup(db: DatabaseAdapter): {
  existingPlatformMsgIds: Set<string>
  existingKeys: Set<string>
} {
  const existingPlatformMsgIds = new Set<string>()
  const existingKeys = new Set<string>()

  const pmidRows = db
    .prepare('SELECT platform_message_id FROM message WHERE platform_message_id IS NOT NULL')
    .all() as Array<{ platform_message_id: string }>
  for (const row of pmidRows) {
    existingPlatformMsgIds.add(row.platform_message_id)
  }

  const hashRows = db
    .prepare(
      `SELECT ts, m.platform_id as sender_platform_id, content
       FROM message msg
       JOIN member m ON msg.sender_id = m.id`
    )
    .all() as Array<{ ts: number; sender_platform_id: string; content: string | null }>
  for (const row of hashRows) {
    existingKeys.add(generateMessageKey(row.ts, row.sender_platform_id, row.content))
  }

  return { existingPlatformMsgIds, existingKeys }
}

function isDuplicate(
  msg: { platformMessageId?: string; timestamp: number; senderPlatformId: string; content: string | null },
  existingPlatformMsgIds: Set<string>,
  existingKeys: Set<string>
): boolean {
  if (msg.platformMessageId) {
    if (existingPlatformMsgIds.has(msg.platformMessageId)) return true
    existingPlatformMsgIds.add(msg.platformMessageId)
    return false
  }
  const key = generateMessageKey(msg.timestamp, msg.senderPlatformId, msg.content)
  if (existingKeys.has(key)) return true
  existingKeys.add(key)
  return false
}

function normalizeTimestamp(timestamp: unknown): number | null {
  const value = typeof timestamp === 'string' && timestamp.trim() !== '' ? Number(timestamp) : timestamp
  return typeof value === 'number' && value > 0 && Number.isFinite(value) ? value : null
}

// ==================== Analyze (dry-run) ====================

export async function analyzeIncrementalImport(
  sessionId: string,
  filePath: string,
  deps: IncrementalImportDeps
): Promise<IncrementalAnalyzeResult> {
  const formatFeature = detectFormat(filePath)
  if (!formatFeature) {
    return { error: 'error.unrecognized_format', newMessageCount: 0, duplicateCount: 0, totalInFile: 0 }
  }

  let db: DatabaseAdapter
  try {
    db = deps.openDatabase(sessionId, true)
  } catch {
    return { error: 'error.session_not_found', newMessageCount: 0, duplicateCount: 0, totalInFile: 0 }
  }

  const { existingPlatformMsgIds, existingKeys } = loadExistingDedup(db)
  db.close()

  let totalInFile = 0
  let newMessageCount = 0
  let duplicateCount = 0

  await streamParseFile(filePath, {
    onMeta: () => {},
    onMembers: () => {},
    onProgress: (progress: ParseProgress) => {
      deps.onProgress(progress)
    },
    onMessageBatch: (batch) => {
      for (const msg of batch) {
        totalInFile++
        const timestamp = normalizeTimestamp(msg.timestamp)
        if (timestamp === null) continue

        if (isDuplicate({ ...msg, timestamp }, existingPlatformMsgIds, existingKeys)) {
          duplicateCount++
        } else {
          newMessageCount++
        }
      }
    },
  })

  return { newMessageCount, duplicateCount, totalInFile }
}

// ==================== Execute incremental import ====================

export async function incrementalImport(
  sessionId: string,
  filePath: string,
  deps: IncrementalImportDeps,
  options?: ImportOptions
): Promise<IncrementalImportResult> {
  const formatFeature = detectFormat(filePath)
  if (!formatFeature) {
    return { success: false, newMessageCount: 0, error: 'error.unrecognized_format' }
  }

  let db: DatabaseAdapter
  try {
    db = deps.openDatabase(sessionId, false)
  } catch {
    return { success: false, newMessageCount: 0, error: 'error.session_not_found' }
  }

  const metaUpdateMode = options?.metaUpdateMode ?? 'patch'
  const memberUpdateMode = options?.memberUpdateMode ?? 'upsert'

  try {
    const { existingPlatformMsgIds, existingKeys } = loadExistingDedup(db)

    const memberIdMap = new Map<string, number>()
    const existingMembers = db.prepare('SELECT id, platform_id FROM member').all() as Array<{
      id: number
      platform_id: string
    }>
    for (const m of existingMembers) {
      memberIdMap.set(m.platform_id, m.id)
    }

    const upsertMember = db.prepare(`
      INSERT INTO member (platform_id, account_name, group_nickname, aliases, avatar, roles)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform_id) DO UPDATE SET
        account_name = COALESCE(NULLIF(excluded.account_name, ''), account_name),
        group_nickname = COALESCE(NULLIF(excluded.group_nickname, ''), group_nickname),
        aliases = CASE WHEN excluded.aliases != '[]' THEN excluded.aliases ELSE aliases END,
        avatar = COALESCE(NULLIF(excluded.avatar, ''), avatar),
        roles = CASE WHEN excluded.roles != '[]' THEN excluded.roles ELSE roles END
    `)

    const insertMemberMinimal = db.prepare(`
      INSERT OR IGNORE INTO member (platform_id, account_name, group_nickname, avatar)
      VALUES (?, ?, ?, ?)
    `)

    const getMemberId = db.prepare('SELECT id FROM member WHERE platform_id = ?')

    const insertMessage = db.prepare(`
      INSERT INTO message (sender_id, sender_account_name, sender_group_nickname, ts, type, content, reply_to_message_id, platform_message_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const updateMeta = db.prepare(`
      UPDATE meta SET
        name = COALESCE(NULLIF(?, ''), name),
        group_id = COALESCE(NULLIF(?, ''), group_id),
        group_avatar = COALESCE(NULLIF(?, ''), group_avatar),
        owner_id = COALESCE(NULLIF(?, ''), owner_id),
        imported_at = ?
    `)

    const preWriteMaxTs =
      (db.prepare('SELECT MAX(ts) as max_ts FROM message').get() as { max_ts: number | null })?.max_ts ?? 0

    db.exec('BEGIN TRANSACTION')

    let newMessageCount = 0
    let duplicateCount = 0
    let processedCount = 0
    let minWrittenTs = Infinity
    let metaUpdated = false
    let membersAdded = 0
    let membersUpdated = 0
    let errorCount = 0
    const errorReasonCounts: Record<string, number> = {}
    const errorSamples: ErrorSample[] = []
    const MAX_ERROR_SAMPLES = 5
    const BATCH_SIZE = 5000

    function trackError(index: number, reason: string, detail: string) {
      errorCount++
      errorReasonCounts[reason] = (errorReasonCounts[reason] || 0) + 1
      if (errorSamples.length < MAX_ERROR_SAMPLES) {
        errorSamples.push({ index, reason, detail })
      }
    }

    const newFtsEntries: Array<{ id: number; content: string | null }> = []

    await streamParseFile(filePath, {
      onMeta: (meta) => {
        if (metaUpdateMode === 'none') return
        updateMeta.run(
          meta.name || '',
          meta.groupId || '',
          meta.groupAvatar || '',
          meta.ownerId || '',
          Math.floor(Date.now() / 1000)
        )
        metaUpdated = true
      },
      onMembers: (members) => {
        if (memberUpdateMode === 'none') return
        for (const m of members) {
          const existed = memberIdMap.has(m.platformId)
          upsertMember.run(
            m.platformId,
            m.accountName || null,
            m.groupNickname || null,
            m.aliases ? JSON.stringify(m.aliases) : '[]',
            m.avatar || null,
            m.roles ? JSON.stringify(m.roles) : '[]'
          )
          if (!existed) {
            const row = getMemberId.get(m.platformId) as { id: number } | undefined
            if (row) memberIdMap.set(m.platformId, row.id)
            membersAdded++
          } else {
            membersUpdated++
          }
        }
      },
      onProgress: (progress: ParseProgress) => {
        deps.onProgress(progress)
      },
      onMessageBatch: (batch) => {
        for (const msg of batch) {
          processedCount++

          if (!msg.senderPlatformId) {
            trackError(processedCount, 'MISSING_SENDER', 'sender field is empty')
            continue
          }
          if (msg.timestamp === undefined || msg.timestamp === null) {
            trackError(processedCount, 'MISSING_TIMESTAMP', 'timestamp field is missing')
            continue
          }
          const timestamp = normalizeTimestamp(msg.timestamp)
          if (timestamp === null) {
            trackError(processedCount, 'INVALID_TIMESTAMP', `timestamp value: ${msg.timestamp}`)
            continue
          }

          if (isDuplicate({ ...msg, timestamp }, existingPlatformMsgIds, existingKeys)) {
            duplicateCount++
            continue
          }

          let memberId = memberIdMap.get(msg.senderPlatformId)
          if (!memberId) {
            insertMemberMinimal.run(
              msg.senderPlatformId,
              msg.senderAccountName || null,
              msg.senderGroupNickname || null,
              null
            )
            const row = getMemberId.get(msg.senderPlatformId) as { id: number } | undefined
            if (row) {
              memberId = row.id
              memberIdMap.set(msg.senderPlatformId, memberId)
              membersAdded++
            }
          }
          if (!memberId) continue

          const msgResult = insertMessage.run(
            memberId,
            msg.senderAccountName || null,
            msg.senderGroupNickname || null,
            timestamp,
            msg.type,
            msg.content || null,
            msg.replyToMessageId || null,
            msg.platformMessageId || null
          )

          newFtsEntries.push({
            id: Number((msgResult as any).lastInsertRowid ?? 0),
            content: msg.content || null,
          })
          if (timestamp < minWrittenTs) minWrittenTs = timestamp
          newMessageCount++
        }

        if (processedCount % BATCH_SIZE === 0) {
          deps.onProgress({
            stage: 'saving',
            bytesRead: 0,
            totalBytes: 0,
            messagesProcessed: processedCount,
            percentage: 50,
            message: `Processed ${processedCount}, added ${newMessageCount}`,
          })
        }
      },
    })

    db.exec('COMMIT')

    if (!metaUpdated) {
      db.prepare('UPDATE meta SET imported_at = ?').run(Math.floor(Date.now() / 1000))
    }

    // Incremental FTS update
    if (newFtsEntries.length > 0 && hasFtsTable(db)) {
      try {
        insertFtsEntries(db, newFtsEntries)
      } catch {
        /* FTS failure is non-fatal */
      }
    }

    // Incremental session index (segment / message_context tables).
    // Use full rebuild for backfill batches: generateIncrementalSessionIndex
    // compares the first new message with the latest existing segment, so an
    // older backfilled message would be incorrectly attached to the newest segment.
    if (newMessageCount > 0) {
      try {
        if (minWrittenTs < preWriteMaxTs) {
          generateSessionIndex(db)
        } else {
          generateIncrementalSessionIndex(db)
        }
      } catch {
        /* non-fatal */
      }
    }

    const sessionStats = db
      .prepare(
        `SELECT
           COUNT(*) as totalCount,
           MIN(ts) as firstTimestamp,
           MAX(ts) as lastTimestamp
         FROM message`
      )
      .get() as { totalCount: number; firstTimestamp: number; lastTimestamp: number }
    const memberCountRow = db.prepare('SELECT COUNT(*) as count FROM member').get() as { count: number }

    // Post-import hook (e.g. overview cache)
    try {
      await deps.postImportHook?.(db, sessionId)
    } catch {
      /* non-fatal */
    }

    db.close()

    deps.onProgress({
      stage: 'done',
      bytesRead: 0,
      totalBytes: 0,
      messagesProcessed: processedCount,
      percentage: 100,
      message: `Import complete, added ${newMessageCount} messages`,
    })

    return {
      success: true,
      newMessageCount,
      batch: {
        receivedCount: processedCount,
        writtenCount: newMessageCount,
        duplicateCount,
        errorCount,
        errorReasonCounts,
        errorSample: errorSamples,
      },
      session: {
        totalCount: sessionStats.totalCount,
        memberCount: memberCountRow.count,
        firstTimestamp: sessionStats.firstTimestamp,
        lastTimestamp: sessionStats.lastTimestamp,
      },
      updates: {
        metaUpdated,
        membersAdded,
        membersUpdated,
      },
    }
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      /* ignore */
    }
    db.close()

    console.error('[IncrementalImport] Error:', error)
    return { success: false, newMessageCount: 0, error: String(error) }
  }
}
