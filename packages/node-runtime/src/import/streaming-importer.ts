/**
 * Platform-agnostic streaming importer.
 *
 * Extracted from electron/main/worker/import/streamImport.ts.
 * Streams parsed data directly into SQLite with batched transactions,
 * deferred index creation, nickname history tracking, and FTS indexing.
 *
 * Both Electron and Server/CLI use this module via dependency injection:
 * the caller provides a DatabaseAdapter, progress callback, and optional hooks.
 */

import type { DatabaseAdapter } from '@openchatlab/core'
import { CHAT_DB_INDEXES, generateSessionIndex } from '@openchatlab/core'
import type { ParsedMember, ParsedMessage } from '@openchatlab/shared-types'
import {
  streamParseFile,
  detectFormat,
  detectAllFormats,
  getFormatFeatureById,
  getPreprocessor,
  needsPreprocess,
  type ParsedMeta,
  type FormatFeature,
  type ParseProgress,
} from '@openchatlab/parser'
import * as fs from 'fs'
import { buildFtsIndex } from '../fts'
import { createMessageDedupState, registerMessageAndCheckDuplicate, type DedupMessage } from './message-deduplicator'

// ==================== Public interfaces ====================

export interface SkipReasons {
  noSenderId: number
  noAccountName: number
  invalidTimestamp: number
  noType: number
}

export interface ImportDiagnostics {
  logFile: string | null
  detectedFormat: string | null
  messagesReceived: number
  messagesWritten: number
  duplicateCount: number
  messagesSkipped: number
  skipReasons: SkipReasons
}

export interface StreamImportResult {
  success: boolean
  sessionId?: string
  error?: string
  diagnostics?: ImportDiagnostics
}

export type ImportProgressCallback = (progress: ParseProgress) => void

export interface ImportLogger {
  info(message: string): void
  error(message: string, err?: Error): void
  perf(label: string, messageCount: number, batchSize?: number): void
  perfDetail(detail: string): void
  summary(messageCount: number, memberCount: number): void
  reset(): void
  init(sessionId: string): void
  getCurrentLogFile(): string | null
}

export interface StreamImportDeps {
  /** Open a new database for writing (tables only, no indexes). */
  openDatabase(sessionId: string): DatabaseAdapter
  /** Delete a database file (and WAL/SHM) on failure. */
  deleteDatabase(sessionId: string): void
  /** Progress callback (IPC postMessage, SSE event, etc.) */
  onProgress: ImportProgressCallback
  /** Optional perf/diagnostic logger */
  logger?: ImportLogger
  /** Optional hook after import completes (e.g. write overview cache) */
  postImportHook?: (db: DatabaseAdapter, sessionId: string) => void | Promise<void>
  /** Generate a session ID. Defaults to timestamp + random. */
  generateSessionId?: () => string
}

// ==================== Core streaming import ====================

const BATCH_COMMIT_SIZE = 50000
const CHECKPOINT_INTERVAL = 200000

/**
 * Let the event loop process pending I/O before a long synchronous step.
 * Without this, progress events written to an SSE socket stay buffered
 * until the blocking work (index/FTS build) finishes.
 */
const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve))

function defaultGenerateSessionId(): string {
  const ts = Date.now()
  const rand = Math.random().toString(36).substring(2, 8)
  return `chat_${ts}_${rand}`
}

type CreateMessageSkipCounter =
  | 'skippedNoSenderId'
  | 'skippedNoAccountName'
  | 'skippedInvalidTimestamp'
  | 'skippedNoType'

type PreparedCreateMessage = { message: DedupMessage } | { skipCounter: CreateMessageSkipCounter }

function prepareMessageForCreate(message: ParsedMessage): PreparedCreateMessage {
  if (!message.senderPlatformId) return { skipCounter: 'skippedNoSenderId' }
  if (!message.senderAccountName) return { skipCounter: 'skippedNoAccountName' }
  if (message.timestamp === undefined || message.timestamp === null || isNaN(message.timestamp)) {
    return { skipCounter: 'skippedInvalidTimestamp' }
  }
  if (message.type === undefined || message.type === null) return { skipCounter: 'skippedNoType' }

  let content: string | null = null
  if (message.content != null) {
    content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
  }

  return {
    message: {
      platformMessageId: message.platformMessageId,
      timestamp: message.timestamp,
      senderPlatformId: message.senderPlatformId,
      type: message.type,
      content,
      replyToMessageId: message.replyToMessageId,
    },
  }
}

/**
 * High-performance streaming import: parse a file and write to DB
 * with batched transactions. Supports format auto-detection with fallback.
 */
export async function streamingImport(
  filePath: string,
  deps: StreamImportDeps,
  formatOptions?: Record<string, unknown>,
  externalSessionId?: string
): Promise<StreamImportResult> {
  if (formatOptions?.formatId) {
    const formatId = formatOptions.formatId as string
    const feature = getFormatFeatureById(formatId)
    if (!feature) {
      return { success: false, error: 'error.unknown_format_id' }
    }
    return streamImportSingle(filePath, deps, feature, formatOptions, externalSessionId)
  }

  const candidates = detectAllFormats(filePath)
  if (candidates.length === 0) {
    return { success: false, error: 'error.unrecognized_format' }
  }

  if (candidates.length > 1) {
    return streamImportWithFallback(filePath, deps, candidates, formatOptions, externalSessionId)
  }

  return streamImportSingle(filePath, deps, candidates[0], formatOptions, externalSessionId)
}

async function streamImportWithFallback(
  filePath: string,
  deps: StreamImportDeps,
  candidates: FormatFeature[],
  formatOptions?: Record<string, unknown>,
  externalSessionId?: string
): Promise<StreamImportResult> {
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]
    deps.logger?.info(`[StreamImport] Trying format ${i + 1}/${candidates.length}: ${candidate.name} (${candidate.id})`)

    const result = await streamImportSingle(filePath, deps, candidate, formatOptions, externalSessionId)

    if (result.success) {
      if (i > 0) {
        deps.logger?.info(
          `[StreamImport] Fallback succeeded: ${candidate.name} (after ${i} failed attempt${i > 1 ? 's' : ''})`
        )
      }
      return result
    }

    if (i === candidates.length - 1) return result

    deps.logger?.info(`[StreamImport] Format ${candidate.name} produced 0 messages, falling back to next candidate...`)
  }

  return { success: false, error: 'error.no_messages' }
}

async function streamImportSingle(
  filePath: string,
  deps: StreamImportDeps,
  formatFeature: FormatFeature,
  formatOptions?: Record<string, unknown>,
  externalSessionId?: string
): Promise<StreamImportResult> {
  const { onProgress, logger } = deps
  const genId = deps.generateSessionId ?? defaultGenerateSessionId

  logger?.reset()
  const sessionId = externalSessionId || genId()
  logger?.init(sessionId)

  logger?.info(`File path: ${filePath}`)
  logger?.info(`Detected format: ${formatFeature.name} (${formatFeature.id})`)
  logger?.info(`Platform: ${formatFeature.platform}`)
  logger?.perf('Import started', 0)

  // Preprocess large files if needed
  let actualFilePath = filePath
  let tempFilePath: string | null = null
  const preprocessor = getPreprocessor(filePath)

  if (preprocessor && needsPreprocess(filePath)) {
    logger?.info('File needs preprocessing, simplifying large file...')
    onProgress({
      stage: 'parsing',
      bytesRead: 0,
      totalBytes: 0,
      messagesProcessed: 0,
      percentage: 0,
      message: '',
    })

    try {
      tempFilePath = await preprocessor.preprocess(filePath, (progress: ParseProgress) => {
        onProgress({ ...progress, message: '' })
      })
      actualFilePath = tempFilePath
      logger?.info(`Preprocessing done, temp file: ${tempFilePath}`)
    } catch (err) {
      const errorMsg = `Preprocessing failed: ${err instanceof Error ? err.message : String(err)}`
      logger?.error(errorMsg, err instanceof Error ? err : undefined)
      return { success: false, error: errorMsg }
    }
  }

  const db = deps.openDatabase(sessionId)

  const insertMeta = db.prepare(
    `INSERT INTO meta (name, platform, type, imported_at, group_id, group_avatar, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  const insertMember = db.prepare(
    `INSERT INTO member (platform_id, account_name, group_nickname, aliases, avatar, roles)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(platform_id) DO UPDATE SET
       account_name = COALESCE(NULLIF(excluded.account_name, ''), account_name),
       group_nickname = COALESCE(NULLIF(excluded.group_nickname, ''), group_nickname),
       aliases = CASE WHEN excluded.aliases != '[]' THEN excluded.aliases ELSE aliases END,
       avatar = COALESCE(NULLIF(excluded.avatar, ''), avatar),
       roles = CASE WHEN excluded.roles != '[]' THEN excluded.roles ELSE roles END`
  )
  const getMemberId = db.prepare(`SELECT id FROM member WHERE platform_id = ?`)
  const insertMessage = db.prepare(
    `INSERT INTO message (sender_id, sender_account_name, sender_group_nickname, ts, type, content, reply_to_message_id, platform_message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertNameHistory = db.prepare(
    `INSERT INTO member_name_history (member_id, name_type, name, start_ts, end_ts) VALUES (?, ?, ?, ?, ?)`
  )
  const updateMemberAccountName = db.prepare(`UPDATE member SET account_name = ? WHERE platform_id = ?`)
  const updateMemberGroupNickname = db.prepare(`UPDATE member SET group_nickname = ? WHERE platform_id = ?`)

  const memberIdMap = new Map<string, number>()
  const accountNameTracker = new Map<
    string,
    { currentName: string; lastSeenTs: number; history: Array<{ name: string; startTs: number }> }
  >()
  const groupNicknameTracker = new Map<
    string,
    { currentName: string; lastSeenTs: number; history: Array<{ name: string; startTs: number }> }
  >()

  let metaInserted = false
  let messageCountInBatch = 0
  let totalMessageCount = 0
  let duplicateCount = 0
  let lastCheckpointCount = 0
  let inTransaction = false

  const beginTransaction = () => {
    if (!inTransaction) {
      db.exec('BEGIN TRANSACTION')
      inTransaction = true
    }
  }

  const doCheckpoint = () => {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)')
    } catch {
      /* ignore */
    }
  }

  const commitAndBeginNew = () => {
    if (inTransaction) {
      db.exec('COMMIT')
      inTransaction = false
      logger?.perf('Commit transaction', totalMessageCount, BATCH_COMMIT_SIZE)

      if (totalMessageCount - lastCheckpointCount >= CHECKPOINT_INTERVAL) {
        doCheckpoint()
        logger?.perf('WAL checkpoint', totalMessageCount)
        lastCheckpointCount = totalMessageCount
      }

      onProgress({
        stage: 'saving',
        bytesRead: 0,
        totalBytes: 0,
        messagesProcessed: totalMessageCount,
        percentage: 100,
        message: '',
      })
    }
    beginTransaction()
  }

  beginTransaction()

  let shouldDeleteDb = false
  let importError: string | null = null

  const callbackStats = {
    onProgressCalls: 0,
    onLogCalls: 0,
    onMetaCalls: 0,
    onMembersCalls: 0,
    onMessageBatchCalls: 0,
    totalMembersReceived: 0,
    totalMessagesReceived: 0,
    skippedNoSenderId: 0,
    skippedNoAccountName: 0,
    skippedInvalidTimestamp: 0,
    skippedNoType: 0,
  }
  const dedupState = createMessageDedupState()

  logger?.info('Starting streamParseFile...')

  try {
    await streamParseFile(
      actualFilePath,
      {
        batchSize: 5000,
        formatOptions,

        onProgress: (progress: ParseProgress) => {
          callbackStats.onProgressCalls++
          onProgress(progress)
        },

        onLog: (level: string, message: string) => {
          callbackStats.onLogCalls++
          if (level === 'error') {
            logger?.error(message)
          } else {
            logger?.info(message)
          }
        },

        onMeta: (meta: ParsedMeta) => {
          callbackStats.onMetaCalls++
          if (!metaInserted) {
            logger?.info(`Writing meta: name=${meta.name}, type=${meta.type}, platform=${meta.platform}`)
            insertMeta.run(
              meta.name,
              meta.platform,
              meta.type,
              Math.floor(Date.now() / 1000),
              meta.groupId || null,
              meta.groupAvatar || null,
              meta.ownerId || null
            )
            metaInserted = true
          }
        },

        onMembers: (members: ParsedMember[]) => {
          callbackStats.onMembersCalls++
          callbackStats.totalMembersReceived += members.length
          logger?.info(`Received member batch: ${members.length} members`)
          for (const member of members) {
            insertMember.run(
              member.platformId,
              member.accountName || null,
              member.groupNickname || null,
              member.aliases ? JSON.stringify(member.aliases) : '[]',
              member.avatar || null,
              member.roles ? JSON.stringify(member.roles) : '[]'
            )
            const row = getMemberId.get(member.platformId) as { id: number } | undefined
            if (row) memberIdMap.set(member.platformId, row.id)
          }
        },

        onMessageBatch: (messages: ParsedMessage[]) => {
          callbackStats.onMessageBatchCalls++
          callbackStats.totalMessagesReceived += messages.length
          if (callbackStats.onMessageBatchCalls <= 3 || callbackStats.onMessageBatchCalls % 10 === 0) {
            logger?.info(`Received message batch #${callbackStats.onMessageBatchCalls}: ${messages.length} messages`)
          }

          let memberLookupTime = 0
          let memberInsertTime = 0
          let messageInsertTime = 0
          let nicknameTrackTime = 0
          let memberLookupCount = 0
          let memberInsertCount = 0
          let nicknameChangeCount = 0

          for (const msg of messages) {
            const prepared = prepareMessageForCreate(msg)
            if ('skipCounter' in prepared) {
              callbackStats[prepared.skipCounter]++
              continue
            }

            const dedupMessage = prepared.message

            if (registerMessageAndCheckDuplicate(dedupMessage, dedupState)) {
              duplicateCount++
              continue
            }

            let t0 = Date.now()
            if (!memberIdMap.has(msg.senderPlatformId)) {
              insertMember.run(
                msg.senderPlatformId,
                msg.senderAccountName || null,
                msg.senderGroupNickname || null,
                '[]',
                null,
                '[]'
              )
              const row = getMemberId.get(msg.senderPlatformId) as { id: number } | undefined
              if (row) memberIdMap.set(msg.senderPlatformId, row.id)
              memberInsertCount++
              memberInsertTime += Date.now() - t0
            } else {
              memberLookupCount++
              memberLookupTime += Date.now() - t0
            }

            const senderId = memberIdMap.get(msg.senderPlatformId)
            if (senderId === undefined) continue

            t0 = Date.now()
            insertMessage.run(
              senderId,
              msg.senderAccountName || null,
              msg.senderGroupNickname || null,
              dedupMessage.timestamp,
              dedupMessage.type,
              dedupMessage.content,
              msg.replyToMessageId || null,
              msg.platformMessageId || null
            )
            messageInsertTime += Date.now() - t0
            messageCountInBatch++
            totalMessageCount++

            t0 = Date.now()
            trackNickname(accountNameTracker, msg.senderPlatformId, msg.senderAccountName, msg.timestamp)
            trackNickname(groupNicknameTracker, msg.senderPlatformId, msg.senderGroupNickname, msg.timestamp)
            nicknameTrackTime += Date.now() - t0
            // nicknameChangeCount is approximate but sufficient for logging
            nicknameChangeCount += accountNameTracker.get(msg.senderPlatformId)?.history.length === 1 ? 0 : 0

            if (messageCountInBatch >= BATCH_COMMIT_SIZE) {
              const detail =
                `[Detail] Member lookup: ${memberLookupTime}ms (${memberLookupCount} times) | ` +
                `Member insert: ${memberInsertTime}ms (${memberInsertCount} times) | ` +
                `Message insert: ${messageInsertTime}ms | ` +
                `Nickname tracking: ${nicknameTrackTime}ms (${nicknameChangeCount} changes)`
              logger?.perfDetail(detail)
              commitAndBeginNew()
              messageCountInBatch = 0
              memberLookupTime = 0
              memberInsertTime = 0
              messageInsertTime = 0
              nicknameTrackTime = 0
              memberLookupCount = 0
              memberInsertCount = 0
              nicknameChangeCount = 0
            }
          }
        },
      },
      formatFeature.id
    )

    if (inTransaction) {
      db.exec('COMMIT')
      inTransaction = false
    }

    // Flush nickname history in batch
    onProgress({
      stage: 'saving',
      bytesRead: 0,
      totalBytes: 0,
      messagesProcessed: totalMessageCount,
      percentage: 100,
      message: '',
    })
    await yieldToEventLoop()
    logger?.perf('Writing nickname history', totalMessageCount)

    db.exec('BEGIN TRANSACTION')
    let historyCount = 0

    flushNicknameHistory(accountNameTracker, 'account_name', memberIdMap, insertNameHistory, updateMemberAccountName)
    flushNicknameHistory(
      groupNicknameTracker,
      'group_nickname',
      memberIdMap,
      insertNameHistory,
      updateMemberGroupNickname
    )
    historyCount = countHistory(accountNameTracker) + countHistory(groupNicknameTracker)

    db.exec('COMMIT')
    logger?.perf(`Nickname history written (${historyCount} entries)`, totalMessageCount)

    // Create indexes (deferred for performance)
    onProgress({
      stage: 'indexing',
      bytesRead: 0,
      totalBytes: 0,
      messagesProcessed: totalMessageCount,
      percentage: 100,
      message: '',
    })
    await yieldToEventLoop()
    logger?.perf('Creating indexes', totalMessageCount)
    db.exec(CHAT_DB_INDEXES)
    logger?.perf('Indexes created', totalMessageCount)

    // Build FTS index
    try {
      buildFtsIndex(db)
      logger?.perf('FTS index built', totalMessageCount)
    } catch (ftsError) {
      logger?.error('FTS index build failed (non-fatal)', ftsError instanceof Error ? ftsError : undefined)
    }

    // Final WAL checkpoint + session index + post-import hook
    onProgress({
      stage: 'indexing',
      bytesRead: 0,
      totalBytes: 0,
      messagesProcessed: totalMessageCount,
      percentage: 100,
      message: '',
    })
    await yieldToEventLoop()
    doCheckpoint()
    logger?.perf('WAL checkpoint done', totalMessageCount)

    // Build session index (segment / message_context tables)
    try {
      generateSessionIndex(db)
      logger?.perf('Session index built', totalMessageCount)
    } catch {
      /* non-fatal */
    }

    // Post-import hook (e.g. overview cache)
    try {
      await deps.postImportHook?.(db, sessionId)
      if (deps.postImportHook) logger?.perf('Post-import hook done', totalMessageCount)
    } catch {
      /* non-fatal */
    }

    logger?.perf('Import completed', totalMessageCount)

    // Diagnostic logging
    logger?.info(`=== Parser Callback Stats ===`)
    logger?.info(`onProgress calls: ${callbackStats.onProgressCalls}`)
    logger?.info(`onLog calls: ${callbackStats.onLogCalls}`)
    logger?.info(`onMeta calls: ${callbackStats.onMetaCalls}`)
    logger?.info(
      `onMembers calls: ${callbackStats.onMembersCalls}, total members: ${callbackStats.totalMembersReceived}`
    )
    logger?.info(
      `onMessageBatch calls: ${callbackStats.onMessageBatchCalls}, total messages: ${callbackStats.totalMessagesReceived}`
    )
    if (
      callbackStats.skippedNoSenderId > 0 ||
      callbackStats.skippedNoAccountName > 0 ||
      callbackStats.skippedInvalidTimestamp > 0 ||
      callbackStats.skippedNoType > 0
    ) {
      logger?.info(`=== Skipped Messages Stats ===`)
      if (callbackStats.skippedNoSenderId > 0)
        logger?.info(`  missing senderPlatformId: ${callbackStats.skippedNoSenderId}`)
      if (callbackStats.skippedNoAccountName > 0)
        logger?.info(`  missing senderAccountName: ${callbackStats.skippedNoAccountName}`)
      if (callbackStats.skippedInvalidTimestamp > 0)
        logger?.info(`  invalid timestamp: ${callbackStats.skippedInvalidTimestamp}`)
      if (callbackStats.skippedNoType > 0) logger?.info(`  missing type: ${callbackStats.skippedNoType}`)
    }
    if (duplicateCount > 0) logger?.info(`Duplicate messages skipped: ${duplicateCount}`)

    logger?.summary(totalMessageCount, memberIdMap.size)

    if (totalMessageCount === 0) {
      logger?.error(
        `Import failed: no messages parsed (received ${callbackStats.totalMessagesReceived} messages, all skipped or none received)`
      )
      shouldDeleteDb = true
      importError = 'error.no_messages'
    }
  } catch (error) {
    logger?.error('Import failed', error instanceof Error ? error : undefined)
    if (inTransaction) {
      try {
        db.exec('ROLLBACK')
      } catch {
        /* ignore */
      }
    }
    shouldDeleteDb = true
    importError = error instanceof Error ? error.message : String(error)
  } finally {
    db.close()

    if (tempFilePath && preprocessor) {
      preprocessor.cleanup(tempFilePath)
    }

    if (shouldDeleteDb) {
      deps.deleteDatabase(sessionId)
    }
  }

  const diagnostics: ImportDiagnostics = {
    logFile: logger?.getCurrentLogFile() ?? null,
    detectedFormat: formatFeature ? `${formatFeature.name} (${formatFeature.id})` : null,
    messagesReceived: callbackStats.totalMessagesReceived,
    messagesWritten: totalMessageCount,
    duplicateCount,
    messagesSkipped:
      callbackStats.skippedNoSenderId +
      callbackStats.skippedNoAccountName +
      callbackStats.skippedInvalidTimestamp +
      callbackStats.skippedNoType,
    skipReasons: {
      noSenderId: callbackStats.skippedNoSenderId,
      noAccountName: callbackStats.skippedNoAccountName,
      invalidTimestamp: callbackStats.skippedInvalidTimestamp,
      noType: callbackStats.skippedNoType,
    },
  }

  if (importError) {
    return { success: false, error: importError, diagnostics }
  }
  return { success: true, sessionId, diagnostics }
}

// ==================== Dry-run analysis ====================

export interface AnalyzeNewImportResult {
  totalMessages: number
  newMessageCount: number
  duplicateCount: number
  totalMembers: number
  meta: { name: string; platform: string; type: string } | null
  error?: string
}

export async function analyzeNewImport(
  filePath: string,
  onProgress: ImportProgressCallback
): Promise<AnalyzeNewImportResult> {
  const formatFeature = detectFormat(filePath)
  if (!formatFeature) {
    return {
      totalMessages: 0,
      newMessageCount: 0,
      duplicateCount: 0,
      totalMembers: 0,
      meta: null,
      error: 'error.unrecognized_format',
    }
  }

  let meta: { name: string; platform: string; type: string } | null = null
  const memberSet = new Set<string>()
  const dedupState = createMessageDedupState()
  let totalMessages = 0
  let newMessageCount = 0
  let duplicateCount = 0

  await streamParseFile(filePath, {
    onMeta: (parsedMeta: ParsedMeta) => {
      meta = { name: parsedMeta.name, platform: parsedMeta.platform, type: parsedMeta.type }
    },
    onMembers: (members: ParsedMember[]) => {
      for (const m of members) memberSet.add(m.platformId)
    },
    onProgress: (progress: ParseProgress) => {
      onProgress(progress)
    },
    onMessageBatch: (batch: ParsedMessage[]) => {
      for (const msg of batch) {
        totalMessages++
        if (!memberSet.has(msg.senderPlatformId)) memberSet.add(msg.senderPlatformId)

        const prepared = prepareMessageForCreate(msg)
        if ('skipCounter' in prepared) continue
        if (registerMessageAndCheckDuplicate(prepared.message, dedupState)) {
          duplicateCount++
        } else {
          newMessageCount++
        }
      }
    },
  })

  return { totalMessages, newMessageCount, duplicateCount, totalMembers: memberSet.size, meta }
}

// ==================== Temp DB for merge preview ====================

export interface StreamParseFileInfoResult {
  name: string
  format: string
  platform: string
  messageCount: number
  memberCount: number
  fileSize: number
  tempDbPath: string
}

export interface StreamParseFileInfoDeps {
  createTempDatabase(filePath: string): { db: DatabaseAdapter; tempDbPath: string }
  onProgress: ImportProgressCallback
}

export async function streamParseFileInfo(
  filePath: string,
  deps: StreamParseFileInfoDeps
): Promise<StreamParseFileInfoResult> {
  const formatFeature = detectFormat(filePath)
  if (!formatFeature) {
    throw new Error('Unrecognized file format')
  }

  const fileSize = fs.statSync(filePath).size

  deps.onProgress({
    stage: 'parsing',
    bytesRead: 0,
    totalBytes: fileSize,
    messagesProcessed: 0,
    percentage: 0,
    message: '',
  })

  const { db, tempDbPath } = deps.createTempDatabase(filePath)

  const insertMeta = db.prepare(
    'INSERT INTO meta (name, platform, type, group_id, group_avatar, owner_id) VALUES (?, ?, ?, ?, ?, ?)'
  )
  const insertMember = db.prepare(
    'INSERT OR IGNORE INTO member (platform_id, account_name, group_nickname, avatar) VALUES (?, ?, ?, ?)'
  )
  const insertMessage = db.prepare(
    `INSERT INTO message (sender_platform_id, sender_account_name, sender_group_nickname, timestamp, type, content)
     VALUES (?, ?, ?, ?, ?, ?)`
  )

  let meta: ParsedMeta = { name: 'Unknown', platform: formatFeature.platform, type: 0 as any }
  const memberSet = new Set<string>()
  let messageCount = 0
  let metaInserted = false

  db.exec('BEGIN TRANSACTION')

  try {
    await streamParseFile(filePath, {
      batchSize: fileSize > 100 * 1024 * 1024 ? 2000 : 5000,

      onProgress: (progress: ParseProgress) => {
        deps.onProgress(progress)
      },

      onMeta: (parsedMeta: ParsedMeta) => {
        meta = parsedMeta
        if (!metaInserted) {
          insertMeta.run(
            parsedMeta.name,
            parsedMeta.platform,
            parsedMeta.type,
            parsedMeta.groupId || null,
            parsedMeta.groupAvatar || null,
            parsedMeta.ownerId || null
          )
          metaInserted = true
        }
      },

      onMembers: (parsedMembers: ParsedMember[]) => {
        for (const m of parsedMembers) {
          if (!memberSet.has(m.platformId)) {
            memberSet.add(m.platformId)
            insertMember.run(m.platformId, m.accountName || null, m.groupNickname || null, m.avatar || null)
          }
        }
      },

      onMessageBatch: (batch: ParsedMessage[]) => {
        for (const msg of batch) {
          if (!memberSet.has(msg.senderPlatformId)) {
            memberSet.add(msg.senderPlatformId)
            insertMember.run(msg.senderPlatformId, msg.senderAccountName || null, msg.senderGroupNickname || null, null)
          }

          insertMessage.run(
            msg.senderPlatformId,
            msg.senderAccountName || null,
            msg.senderGroupNickname || null,
            msg.timestamp,
            msg.type,
            msg.content || null
          )
          messageCount++
        }
      },
    })

    db.exec('COMMIT')
    db.close()

    return {
      name: meta.name,
      format: formatFeature.name,
      platform: meta.platform,
      messageCount,
      memberCount: memberSet.size,
      fileSize,
      tempDbPath,
    }
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      /* ignore */
    }
    db.close()

    try {
      if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath)
    } catch {
      /* ignore */
    }

    throw error
  }
}

// ==================== Internal helpers ====================

type NicknameTracker = Map<
  string,
  { currentName: string; lastSeenTs: number; history: Array<{ name: string; startTs: number }> }
>

function trackNickname(
  tracker: NicknameTracker,
  platformId: string,
  name: string | undefined | null,
  timestamp: number
): void {
  if (!name) return
  // For account_name tracking, skip if name equals platformId
  const existing = tracker.get(platformId)
  if (!existing) {
    tracker.set(platformId, {
      currentName: name,
      lastSeenTs: timestamp,
      history: [{ name, startTs: timestamp }],
    })
  } else if (existing.currentName !== name) {
    existing.history.push({ name, startTs: timestamp })
    existing.currentName = name
    existing.lastSeenTs = timestamp
  } else {
    existing.lastSeenTs = timestamp
  }
}

interface PreparedStatement {
  run(...args: unknown[]): unknown
}

function flushNicknameHistory(
  tracker: NicknameTracker,
  nameType: string,
  memberIdMap: Map<string, number>,
  insertNameHistory: PreparedStatement,
  updateMemberName: PreparedStatement
): void {
  for (const [platformId, data] of tracker.entries()) {
    if (!platformId || platformId === '0' || platformId === 'undefined') continue

    const senderId = memberIdMap.get(platformId)
    if (!senderId) continue

    const uniqueNames = new Map<string, { startTs: number; lastTs: number }>()
    for (const h of data.history) {
      const existing = uniqueNames.get(h.name)
      if (!existing) {
        uniqueNames.set(h.name, { startTs: h.startTs, lastTs: h.startTs })
      } else {
        existing.lastTs = h.startTs
      }
    }

    // For account_name, skip the platformId itself
    if (nameType === 'account_name') {
      uniqueNames.delete(platformId)
    }

    if (uniqueNames.size <= 1) {
      updateMemberName.run(data.currentName, platformId)
      continue
    }

    const sortedHistory = Array.from(uniqueNames.entries()).sort((a, b) => a[1].startTs - b[1].startTs)
    for (let i = 0; i < sortedHistory.length; i++) {
      const [name, { startTs }] = sortedHistory[i]
      const endTs = i < sortedHistory.length - 1 ? sortedHistory[i + 1][1].startTs : null
      insertNameHistory.run(senderId, nameType, name, startTs, endTs)
    }

    updateMemberName.run(data.currentName, platformId)
  }
}

function countHistory(tracker: NicknameTracker): number {
  let count = 0
  for (const [, data] of tracker.entries()) {
    if (data.history.length > 1) count += data.history.length
  }
  return count
}
