/**
 * Platform-agnostic incremental importer.
 *
 * Extracted from electron/main/worker/import/incrementalImport.ts.
 * Appends new messages to an existing session, using dual-path dedup:
 * platformMessageId (preferred) + content hash (fallback).
 *
 * Callers provide DatabaseAdapter + progress callback via dependency injection.
 */

import type { DatabaseAdapter, PreparedStatement } from '@openchatlab/core'
import { generateSessionIndex, generateIncrementalSessionIndex, getSessionIndexStats } from '@openchatlab/core'
import {
  streamParseFile,
  detectFormat,
  getFormatFeatureById,
  type ParseProgress,
  type StreamParseCallbacks,
} from '@openchatlab/parser'
import {
  applyPlatformMessageIdScope,
  createMessageDedupState,
  generateFallbackMessageKey,
  registerMessageAndCheckDuplicate,
  type DedupMessage,
  type MessageDedupState,
} from './message-deduplicator'
import {
  normalizeSystemMemberName,
  shouldPreserveFallbackMultiplicity,
  SYSTEM_MEMBER_NAME,
  type ImportProgressCallback,
} from './streaming-importer'

// ==================== Public interfaces ====================

export interface SenderPlatformIdMapping {
  sourceId: string
  targetId: string
}

export interface ImportOptions {
  metaUpdateMode?: 'patch' | 'none'
  memberUpdateMode?: 'upsert' | 'none'
  formatId?: string
  chatIndex?: number
  /** Internal scope selected by automatic matching for merger-namespaced message IDs. */
  platformMessageIdScope?: string
  /** Source-to-target sender IDs proven by automatic platform-message matching. */
  senderPlatformIdMappings?: SenderPlatformIdMapping[]
}

export interface IncrementalAnalyzeResult {
  newMessageCount: number
  duplicateCount: number
  totalInFile: number
  platform?: string
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
  /** Optional parser diagnostics hook (e.g. native parser fallback monitoring). */
  onParserLog?: NonNullable<StreamParseCallbacks['onLog']>
  /** Optional hook after incremental import (e.g. update overview cache). */
  postImportHook?: (db: DatabaseAdapter, sessionId: string) => void | Promise<void>
}

// ==================== Internal helpers ====================

const PLATFORM_ID_QUERY_CHUNK_SIZE = 500

interface ExistingMessageCandidate {
  type: number
  content: string | null
  reply_to_message_id: string | null
  platform_message_id: string | null
}

interface ExistingMessageLookup {
  db: DatabaseAdapter
  maxMessageId: number
  hasFallbackOnlyMessages: boolean
  consumedFallbackOnlyOccurrenceCounts: Map<string, number>
  bridgedPlatformMessageIds: Set<string>
  consumedFallbackOccurrenceCounts: Map<string, number>
  candidateStatement: PreparedStatement
  platformIdStatements: Map<number, PreparedStatement>
}

type CandidateCache = Map<string, ExistingMessageCandidate[]>

function applyMessageIdScope<T extends { platformMessageId?: string; replyToMessageId?: string }>(
  message: T,
  scope: string | undefined
): T {
  if (!scope) return message
  return {
    ...message,
    platformMessageId: applyPlatformMessageIdScope(message.platformMessageId, scope),
    replyToMessageId: applyPlatformMessageIdScope(message.replyToMessageId, scope),
  }
}

function createPlatformIdMapper(mappings: SenderPlatformIdMapping[] | undefined): (platformId: string) => string {
  const mapping = new Map(mappings?.map(({ sourceId, targetId }) => [sourceId, targetId]))
  return (platformId) => mapping.get(platformId) ?? platformId
}

function applySenderPlatformIdMapping<T extends { senderPlatformId: string }>(
  message: T,
  mapPlatformId: (platformId: string) => string
): T {
  const senderPlatformId = mapPlatformId(message.senderPlatformId)
  return senderPlatformId === message.senderPlatformId ? message : { ...message, senderPlatformId }
}

function createExistingMessageLookup(db: DatabaseAdapter): ExistingMessageLookup {
  const maxMessageId =
    (db.prepare('SELECT MAX(id) AS max_id FROM message').get() as { max_id: number | null } | undefined)?.max_id ?? 0
  const hasFallbackOnlyMessages = Boolean(
    db
      .prepare(
        `SELECT 1 FROM message
         WHERE id <= ? AND (platform_message_id IS NULL OR platform_message_id = '')
         LIMIT 1`
      )
      .get(maxMessageId)
  )

  return {
    db,
    maxMessageId,
    hasFallbackOnlyMessages,
    consumedFallbackOnlyOccurrenceCounts: new Map<string, number>(),
    bridgedPlatformMessageIds: new Set<string>(),
    consumedFallbackOccurrenceCounts: new Map<string, number>(),
    candidateStatement: db.prepare(
      `SELECT msg.type, msg.content, msg.reply_to_message_id, msg.platform_message_id
       FROM member m
       JOIN message msg ON msg.sender_id = m.id
       WHERE m.platform_id = ? AND msg.ts = ? AND msg.id <= ?`
    ),
    platformIdStatements: new Map<number, PreparedStatement>(),
  }
}

function findExistingPlatformMessageIds(
  lookup: ExistingMessageLookup,
  platformMessageIds: Iterable<string | undefined>
): Set<string> {
  const uniqueIds = [...new Set([...platformMessageIds].filter((id): id is string => Boolean(id)))]
  const existingIds = new Set<string>()

  for (let start = 0; start < uniqueIds.length; start += PLATFORM_ID_QUERY_CHUNK_SIZE) {
    const chunk = uniqueIds.slice(start, start + PLATFORM_ID_QUERY_CHUNK_SIZE)
    let statement = lookup.platformIdStatements.get(chunk.length)
    if (!statement) {
      const placeholders = chunk.map(() => '?').join(', ')
      statement = lookup.db.prepare(
        `SELECT platform_message_id
         FROM message
         WHERE id <= ? AND platform_message_id IN (${placeholders})`
      )
      lookup.platformIdStatements.set(chunk.length, statement)
    }
    const rows = statement.all(lookup.maxMessageId, ...chunk) as Array<{ platform_message_id: string }>
    for (const row of rows) existingIds.add(row.platform_message_id)
  }

  return existingIds
}

function getExistingCandidates(
  lookup: ExistingMessageLookup,
  message: DedupMessage,
  cache: CandidateCache
): ExistingMessageCandidate[] {
  const cacheKey = JSON.stringify([message.senderPlatformId, message.timestamp])
  const cached = cache.get(cacheKey)
  if (cached) return cached

  const rows = lookup.candidateStatement.all(
    message.senderPlatformId,
    message.timestamp,
    lookup.maxMessageId
  ) as unknown as ExistingMessageCandidate[]
  cache.set(cacheKey, rows)
  return rows
}

function candidateFallbackKey(message: DedupMessage, candidate: ExistingMessageCandidate): string {
  return generateFallbackMessageKey({
    timestamp: message.timestamp,
    senderPlatformId: message.senderPlatformId,
    type: candidate.type,
    content: candidate.content,
    replyToMessageId: candidate.reply_to_message_id ?? undefined,
  })
}

function isExistingMessageDuplicate(
  lookup: ExistingMessageLookup,
  message: DedupMessage,
  existingBatchPlatformIds: Set<string>,
  candidateCache: CandidateCache,
  preserveFallbackMultiplicity: boolean
): boolean {
  if (
    message.platformMessageId &&
    (existingBatchPlatformIds.has(message.platformMessageId) ||
      lookup.bridgedPlatformMessageIds.has(message.platformMessageId))
  ) {
    return true
  }

  const fallbackKey = generateFallbackMessageKey(message)
  if (message.platformMessageId) {
    if (!lookup.hasFallbackOnlyMessages) return false
    const matchingFallbackOnlyCount = getExistingCandidates(lookup, message, candidateCache).filter(
      (candidate) => !candidate.platform_message_id && candidateFallbackKey(message, candidate) === fallbackKey
    ).length
    const consumedCount = lookup.consumedFallbackOnlyOccurrenceCounts.get(fallbackKey) ?? 0
    const matchesFallbackOnly = preserveFallbackMultiplicity
      ? consumedCount < matchingFallbackOnlyCount
      : consumedCount === 0 && matchingFallbackOnlyCount > 0
    if (matchesFallbackOnly) {
      lookup.consumedFallbackOnlyOccurrenceCounts.set(fallbackKey, consumedCount + 1)
      lookup.bridgedPlatformMessageIds.add(message.platformMessageId)
    }
    return matchesFallbackOnly
  }

  const matchingCount = getExistingCandidates(lookup, message, candidateCache).filter(
    (candidate) => candidateFallbackKey(message, candidate) === fallbackKey
  ).length
  if (!preserveFallbackMultiplicity) return matchingCount > 0

  const consumedCount = lookup.consumedFallbackOccurrenceCounts.get(fallbackKey) ?? 0
  if (consumedCount >= matchingCount) return false
  lookup.consumedFallbackOccurrenceCounts.set(fallbackKey, consumedCount + 1)
  return true
}

function isDuplicate(
  lookup: ExistingMessageLookup,
  incomingState: MessageDedupState,
  message: DedupMessage,
  existingBatchPlatformIds: Set<string>,
  candidateCache: CandidateCache,
  preserveFallbackMultiplicity: boolean
): boolean {
  if (
    isExistingMessageDuplicate(lookup, message, existingBatchPlatformIds, candidateCache, preserveFallbackMultiplicity)
  )
    return true
  return registerMessageAndCheckDuplicate(message, incomingState)
}

export function normalizeImportTimestamp(timestamp: unknown): number | null {
  const value = typeof timestamp === 'string' && timestamp.trim() !== '' ? Number(timestamp) : timestamp
  return typeof value === 'number' && value > 0 && Number.isFinite(value) ? value : null
}

// ==================== Analyze (dry-run) ====================

export async function analyzeIncrementalImport(
  sessionId: string,
  filePath: string,
  deps: IncrementalImportDeps,
  options?: ImportOptions
): Promise<IncrementalAnalyzeResult> {
  const formatFeature = options?.formatId ? getFormatFeatureById(options.formatId) : detectFormat(filePath)
  if (!formatFeature) {
    return { error: 'error.unrecognized_format', newMessageCount: 0, duplicateCount: 0, totalInFile: 0 }
  }

  let db: DatabaseAdapter
  try {
    db = deps.openDatabase(sessionId, true)
  } catch {
    return { error: 'error.session_not_found', newMessageCount: 0, duplicateCount: 0, totalInFile: 0 }
  }

  let totalInFile = 0
  let newMessageCount = 0
  let duplicateCount = 0
  let platform = formatFeature.platform
  const mapPlatformId = createPlatformIdMapper(options?.senderPlatformIdMappings)
  const preserveFallbackMultiplicity = shouldPreserveFallbackMultiplicity(formatFeature.id)

  try {
    const existingLookup = createExistingMessageLookup(db)
    const incomingState = createMessageDedupState([], [], [], { preserveFallbackMultiplicity })

    await streamParseFile(
      filePath,
      {
        formatOptions: options?.chatIndex === undefined ? undefined : { chatIndex: options.chatIndex },
        onMeta: (meta) => {
          platform = meta.platform
        },
        onMembers: () => {},
        onProgress: (progress: ParseProgress) => {
          deps.onProgress(progress)
        },
        onLog: deps.onParserLog,
        onMessageBatch: (batch) => {
          const scopedBatch = batch.map((message) =>
            applyMessageIdScope(applySenderPlatformIdMapping(message, mapPlatformId), options?.platformMessageIdScope)
          )
          const existingBatchPlatformIds = findExistingPlatformMessageIds(
            existingLookup,
            scopedBatch.map((message) => message.platformMessageId)
          )
          const candidateCache: CandidateCache = new Map()

          for (const msg of scopedBatch) {
            totalInFile++
            const timestamp = normalizeImportTimestamp(msg.timestamp)
            if (timestamp === null) continue

            if (
              isDuplicate(
                existingLookup,
                incomingState,
                { ...msg, timestamp },
                existingBatchPlatformIds,
                candidateCache,
                preserveFallbackMultiplicity
              )
            ) {
              duplicateCount++
            } else {
              newMessageCount++
            }
          }
        },
      },
      options?.formatId
    )
  } finally {
    db.close()
  }

  return { newMessageCount, duplicateCount, totalInFile, platform }
}

// ==================== Execute incremental import ====================

export async function incrementalImport(
  sessionId: string,
  filePath: string,
  deps: IncrementalImportDeps,
  options?: ImportOptions
): Promise<IncrementalImportResult> {
  const formatFeature = options?.formatId ? getFormatFeatureById(options.formatId) : detectFormat(filePath)
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
  const mapPlatformId = createPlatformIdMapper(options?.senderPlatformIdMappings)
  const preserveFallbackMultiplicity = shouldPreserveFallbackMultiplicity(formatFeature.id)

  try {
    const existingLookup = createExistingMessageLookup(db)
    const incomingState = createMessageDedupState([], [], [], { preserveFallbackMultiplicity })

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

    await streamParseFile(
      filePath,
      {
        formatOptions: options?.chatIndex === undefined ? undefined : { chatIndex: options.chatIndex },
        onMeta: (meta) => {
          if (metaUpdateMode === 'none') return
          updateMeta.run(
            meta.name || '',
            meta.groupId || '',
            meta.groupAvatar || '',
            meta.ownerId ? mapPlatformId(meta.ownerId) : '',
            Math.floor(Date.now() / 1000)
          )
          metaUpdated = true
        },
        onMembers: (members) => {
          if (memberUpdateMode === 'none') return
          for (const m of members) {
            const platformId = mapPlatformId(m.platformId)
            const existed = memberIdMap.has(platformId)
            const accountName = normalizeSystemMemberName(formatFeature.id, platformId, m.accountName)
            const groupNickname = normalizeSystemMemberName(formatFeature.id, platformId, m.groupNickname)
            upsertMember.run(
              platformId,
              accountName || null,
              groupNickname || null,
              m.aliases ? JSON.stringify(m.aliases) : '[]',
              m.avatar || null,
              m.roles ? JSON.stringify(m.roles) : '[]'
            )
            if (!existed) {
              const row = getMemberId.get(platformId) as { id: number } | undefined
              if (row) memberIdMap.set(platformId, row.id)
              membersAdded++
            } else {
              membersUpdated++
            }
          }
        },
        onProgress: (progress: ParseProgress) => {
          deps.onProgress(progress)
        },
        onLog: deps.onParserLog,
        onMessageBatch: (batch) => {
          const scopedBatch = batch.map((message) =>
            applyMessageIdScope(applySenderPlatformIdMapping(message, mapPlatformId), options?.platformMessageIdScope)
          )
          const existingBatchPlatformIds = findExistingPlatformMessageIds(
            existingLookup,
            scopedBatch.map((message) => message.platformMessageId)
          )
          const candidateCache: CandidateCache = new Map()

          for (const msg of scopedBatch) {
            processedCount++

            if (!msg.senderPlatformId) {
              trackError(processedCount, 'MISSING_SENDER', 'sender field is empty')
              continue
            }
            if (msg.timestamp === undefined || msg.timestamp === null) {
              trackError(processedCount, 'MISSING_TIMESTAMP', 'timestamp field is missing')
              continue
            }
            const timestamp = normalizeImportTimestamp(msg.timestamp)
            if (timestamp === null) {
              trackError(processedCount, 'INVALID_TIMESTAMP', `timestamp value: ${msg.timestamp}`)
              continue
            }

            if (
              isDuplicate(
                existingLookup,
                incomingState,
                { ...msg, timestamp },
                existingBatchPlatformIds,
                candidateCache,
                preserveFallbackMultiplicity
              )
            ) {
              duplicateCount++
              continue
            }

            const senderAccountName = normalizeSystemMemberName(
              formatFeature.id,
              msg.senderPlatformId,
              msg.senderAccountName
            )
            const senderGroupNickname = normalizeSystemMemberName(
              formatFeature.id,
              msg.senderPlatformId,
              msg.senderGroupNickname
            )
            let memberId = memberIdMap.get(msg.senderPlatformId)
            if (!memberId) {
              insertMemberMinimal.run(
                msg.senderPlatformId,
                senderAccountName || null,
                senderGroupNickname || null,
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

            insertMessage.run(
              memberId,
              senderAccountName || null,
              senderGroupNickname || null,
              timestamp,
              msg.type,
              msg.content || null,
              msg.replyToMessageId || null,
              msg.platformMessageId || null
            )

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
      },
      options?.formatId
    )

    db.exec('COMMIT')

    if (!metaUpdated) {
      db.prepare('UPDATE meta SET imported_at = ?').run(Math.floor(Date.now() / 1000))
    }

    // Incremental session index (segment / message_context tables).
    // Use full rebuild for backfill batches: generateIncrementalSessionIndex
    // compares the first new message with the latest existing segment, so an
    // older backfilled message would be incorrectly attached to the newest segment.
    if (newMessageCount > 0) {
      try {
        const sessionGapThreshold = getSessionIndexStats(db).gapThreshold
        if (minWrittenTs < preWriteMaxTs) {
          generateSessionIndex(db, sessionGapThreshold)
        } else {
          generateIncrementalSessionIndex(db, sessionGapThreshold)
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
    const memberCountRow = db
      .prepare(`SELECT COUNT(*) as count FROM member WHERE COALESCE(account_name, '') != ?`)
      .get(SYSTEM_MEMBER_NAME) as { count: number }

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
