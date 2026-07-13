/**
 * Push import service — handles POST /api/v1/imports/:sessionId
 *
 * Accepts a ChatLab Format JSON payload, creates or appends to a session.
 * Dedup: platformMessageId (preferred) or deterministic fallback key.
 */

import * as fs from 'fs'
import { DataDirCompatibilityError } from '../data-dir-compat'
import { CHAT_DB_SCHEMA, generateSessionIndex, generateIncrementalSessionIndex } from '@openchatlab/core'
import type { DatabaseAdapter } from '@openchatlab/core'
import type { DatabaseManager } from '../database-manager'
import { buildFtsIndex, insertFtsEntries } from '../fts'
import { writeParseResultToDb } from '../import'
import { ImportInProgressError, withDataDirImportLock } from '../import/import-lock'
import {
  createMessageDedupState,
  generateFallbackMessageKey,
  registerMessageAndCheckDuplicate,
  type MessageDedupState,
} from '../import/message-deduplicator'
import { appLogger } from '../logging/app-logger'
import { isValidImportSessionId } from '../import/session-id'

const SYSTEM_SENDER_ID = 'SYSTEM'
const SYSTEM_MEMBER_NAME = '系统消息'

export interface PushImportMessage {
  sender: string
  timestamp: number
  type: number
  accountName?: string
  groupNickname?: string
  content?: string | null
  platformMessageId?: string
  replyToMessageId?: string
}

export interface PushImportMember {
  platformId: string
  accountName?: string
  groupNickname?: string
  avatar?: string
  roles?: Array<{ id: string }>
}

export interface PushImportMeta {
  name: string
  platform: string
  type: string
  groupId?: string
  groupAvatar?: string
  ownerId?: string
}

export interface PushImportPayload {
  chatlab?: { version: string; exportedAt: number; generator?: string }
  meta?: PushImportMeta
  members?: PushImportMember[]
  messages?: PushImportMessage[]
  options?: {
    metaUpdateMode?: 'patch' | 'none'
    memberUpdateMode?: 'upsert' | 'none'
  }
}

export interface PushImportResult {
  sessionId: string
  created: boolean
  batch: { receivedCount: number; writtenCount: number; duplicateCount: number }
  session: { totalCount: number; memberCount: number; firstTimestamp: number | null; lastTimestamp: number | null }
  updates: { metaUpdated: boolean; membersAdded: number; membersUpdated: number }
}

export type PushImportOutcome =
  | { ok: true; result: PushImportResult }
  | { ok: false; reason: 'import_in_progress' | 'invalid_payload' | 'import_failed'; message: string }

export interface PushImportExecutionDeps {
  getDbPath(sessionId: string): string
  openDatabase(sessionId: string, options: { readonly?: boolean; create?: boolean }): DatabaseAdapter
  deleteDatabase(sessionId: string): void
}

function validatePayload(payload: PushImportPayload, isNew: boolean): string | null {
  const messages = payload.messages
  if (!Array.isArray(messages) || messages.length === 0) return 'messages is required and must be a non-empty array'

  if (isNew) {
    if (!payload.chatlab) return 'chatlab is required for new sessions'
    if (!payload.meta) return 'meta is required for new sessions'
    const m = payload.meta
    if (!m.name) return 'meta.name is required'
    if (!m.platform) return 'meta.platform is required'
    if (!m.type) return 'meta.type is required'
  }

  const { metaUpdateMode, memberUpdateMode } = payload.options ?? {}
  if (metaUpdateMode !== undefined && metaUpdateMode !== 'patch' && metaUpdateMode !== 'none') {
    return `options.metaUpdateMode must be 'patch' or 'none'`
  }
  if (memberUpdateMode !== undefined && memberUpdateMode !== 'upsert' && memberUpdateMode !== 'none') {
    return `options.memberUpdateMode must be 'upsert' or 'none'`
  }

  if (payload.members !== undefined && !Array.isArray(payload.members)) return 'members must be an array'
  if (payload.members) {
    for (let i = 0; i < payload.members.length; i++) {
      if (typeof payload.members[i].platformId !== 'string' || payload.members[i].platformId.length === 0)
        return `members[${i}].platformId must be a string`
    }
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (typeof msg.sender !== 'string' || msg.sender.length === 0) return `messages[${i}].sender must be a string`
    if (typeof msg.timestamp !== 'number' || msg.timestamp <= 0)
      return `messages[${i}].timestamp must be a positive number`
    if (typeof msg.type !== 'number') return `messages[${i}].type must be a number`
    if (msg.content !== undefined && msg.content !== null && typeof msg.content !== 'string')
      return `messages[${i}].content must be a string or null`
    if (msg.platformMessageId !== undefined && typeof msg.platformMessageId !== 'string')
      return `messages[${i}].platformMessageId must be a string`
    if (msg.replyToMessageId !== undefined && typeof msg.replyToMessageId !== 'string')
      return `messages[${i}].replyToMessageId must be a string`
  }

  return null
}

function queryStats(db: DatabaseAdapter): PushImportResult['session'] {
  const row = db.prepare('SELECT COUNT(*) as total, MIN(ts) as first, MAX(ts) as last FROM message').get() as {
    total: number
    first: number | null
    last: number | null
  }
  const memberRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM member WHERE COALESCE(account_name, '') != ?`)
    .get(SYSTEM_MEMBER_NAME) as { cnt: number }
  return { totalCount: row.total, memberCount: memberRow.cnt, firstTimestamp: row.first, lastTimestamp: row.last }
}

function normalizeSenderAccountName(sender: string, accountName: string | undefined): string | undefined {
  return sender === SYSTEM_SENDER_ID ? SYSTEM_MEMBER_NAME : accountName
}

function normalizeSenderGroupNickname(sender: string, groupNickname: string | undefined): string | undefined {
  return sender === SYSTEM_SENDER_ID ? SYSTEM_MEMBER_NAME : groupNickname
}

function writeMessages(
  db: DatabaseAdapter,
  messages: PushImportMessage[],
  dedupState: MessageDedupState
): {
  writtenCount: number
  duplicateCount: number
  minWrittenTs: number
  ftsEntries: Array<{ id: number; content: string | null }>
} {
  const insertMsg = db.prepare(
    `INSERT INTO message (sender_id, sender_account_name, sender_group_nickname, ts, type, content, reply_to_message_id, platform_message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const getMemberId = db.prepare('SELECT id FROM member WHERE platform_id = ?')
  const insertMinimalMember = db.prepare('INSERT OR IGNORE INTO member (platform_id, account_name) VALUES (?, ?)')

  const memberIdCache = new Map<string, number>()
  let writtenCount = 0
  let duplicateCount = 0
  let minWrittenTs = Infinity
  const ftsEntries: Array<{ id: number; content: string | null }> = []

  const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp)

  db.transaction(() => {
    for (const msg of sorted) {
      if (
        registerMessageAndCheckDuplicate(
          {
            platformMessageId: msg.platformMessageId,
            timestamp: msg.timestamp,
            senderPlatformId: msg.sender,
            type: msg.type,
            content: msg.content ?? null,
            replyToMessageId: msg.replyToMessageId,
          },
          dedupState
        )
      ) {
        duplicateCount++
        continue
      }

      let memberId = memberIdCache.get(msg.sender)
      if (!memberId) {
        insertMinimalMember.run(msg.sender, normalizeSenderAccountName(msg.sender, msg.accountName) || null)
        const row = getMemberId.get(msg.sender) as { id: number } | undefined
        if (row) {
          memberId = row.id
          memberIdCache.set(msg.sender, memberId)
        }
      }
      if (!memberId) continue

      const result = insertMsg.run(
        memberId,
        normalizeSenderAccountName(msg.sender, msg.accountName) || null,
        normalizeSenderGroupNickname(msg.sender, msg.groupNickname) || null,
        msg.timestamp,
        msg.type,
        msg.content ?? null,
        msg.replyToMessageId || null,
        msg.platformMessageId || null
      )
      ftsEntries.push({ id: Number(result.lastInsertRowid), content: msg.content ?? null })
      if (msg.timestamp < minWrittenTs) minWrittenTs = msg.timestamp
      writtenCount++
    }
  })

  return { writtenCount, duplicateCount, minWrittenTs, ftsEntries }
}

function fullImport(
  db: DatabaseAdapter,
  meta: PushImportMeta,
  members: PushImportMember[],
  messages: PushImportMessage[]
): { writtenCount: number; duplicateCount: number; membersAdded: number } {
  db.exec(CHAT_DB_SCHEMA)

  // Auto-create minimal member entries for senders not listed in members,
  // preserving the protocol promise that unknown senders are auto-created.
  const knownIds = new Set(members.map((m) => m.platformId))
  const extraMembers: PushImportMember[] = []
  for (const msg of messages) {
    if (!knownIds.has(msg.sender)) {
      extraMembers.push({
        platformId: msg.sender,
        accountName: normalizeSenderAccountName(msg.sender, msg.accountName),
        groupNickname: normalizeSenderGroupNickname(msg.sender, msg.groupNickname),
      })
      knownIds.add(msg.sender)
    }
  }
  const allMembers = extraMembers.length > 0 ? [...members, ...extraMembers] : members

  // Deduplicate within the batch using the same pmid/hash logic as incremental imports.
  const dedupState = createMessageDedupState()
  let duplicateCount = 0
  const dedupedMessages: PushImportMessage[] = []
  for (const msg of messages) {
    if (
      registerMessageAndCheckDuplicate(
        {
          platformMessageId: msg.platformMessageId,
          timestamp: msg.timestamp,
          senderPlatformId: msg.sender,
          type: msg.type,
          content: msg.content ?? null,
          replyToMessageId: msg.replyToMessageId,
        },
        dedupState
      )
    ) {
      duplicateCount++
      continue
    }
    dedupedMessages.push(msg)
  }

  // Delegate to the shared writer so member_name_history is tracked correctly,
  // matching the behaviour of file-based full imports.
  const stats = writeParseResultToDb(
    db,
    meta,
    allMembers.map((m) => ({
      ...m,
      accountName: normalizeSenderAccountName(m.platformId, m.accountName) ?? m.platformId,
      groupNickname: normalizeSenderGroupNickname(m.platformId, m.groupNickname),
    })),
    dedupedMessages.map((m) => ({
      senderPlatformId: m.sender,
      senderAccountName: normalizeSenderAccountName(m.sender, m.accountName) ?? m.sender,
      senderGroupNickname: normalizeSenderGroupNickname(m.sender, m.groupNickname),
      timestamp: m.timestamp,
      type: m.type,
      content: m.content ?? null,
      platformMessageId: m.platformMessageId,
      replyToMessageId: m.replyToMessageId,
    }))
  )

  buildFtsIndex(db)

  try {
    generateSessionIndex(db)
  } catch {
    /* non-fatal */
  }

  return { writtenCount: stats.messageCount, duplicateCount, membersAdded: members.length }
}

function incrementalImport(
  db: DatabaseAdapter,
  payload: PushImportPayload
): {
  writtenCount: number
  duplicateCount: number
  metaUpdated: boolean
  membersAdded: number
  membersUpdated: number
} {
  const metaUpdateMode = payload.options?.metaUpdateMode ?? 'patch'
  const memberUpdateMode = payload.options?.memberUpdateMode ?? 'upsert'

  // Load dedup keys
  const existingPmids = new Set<string>()
  const existingKeys = new Set<string>()
  const existingFallbackOnlyKeys = new Set<string>()
  const existingMessages = db
    .prepare(
      `SELECT msg.ts, m.platform_id, msg.type, msg.content, msg.reply_to_message_id, msg.platform_message_id
       FROM message msg
       JOIN member m ON msg.sender_id = m.id`
    )
    .all() as Array<{
    ts: number
    platform_id: string
    type: number
    content: string | null
    reply_to_message_id: string | null
    platform_message_id: string | null
  }>
  for (const message of existingMessages) {
    if (message.platform_message_id) existingPmids.add(message.platform_message_id)
    const key = generateFallbackMessageKey({
      timestamp: message.ts,
      senderPlatformId: message.platform_id,
      type: message.type,
      content: message.content,
      replyToMessageId: message.reply_to_message_id ?? undefined,
    })
    existingKeys.add(key)
    if (!message.platform_message_id) existingFallbackOnlyKeys.add(key)
  }
  const dedupState = createMessageDedupState(existingPmids, existingKeys, existingFallbackOnlyKeys)

  let metaUpdated = false
  let membersAdded = 0
  let membersUpdated = 0

  if (payload.meta && metaUpdateMode === 'patch') {
    const m = payload.meta
    db.prepare(
      `UPDATE meta SET name = COALESCE(NULLIF(?, ''), name), group_id = COALESCE(NULLIF(?, ''), group_id), group_avatar = COALESCE(NULLIF(?, ''), group_avatar), owner_id = COALESCE(NULLIF(?, ''), owner_id), imported_at = ?`
    ).run(m.name || '', m.groupId || '', m.groupAvatar || '', m.ownerId || '', Math.floor(Date.now() / 1000))
    metaUpdated = true
  }

  if (payload.members && memberUpdateMode === 'upsert') {
    const upsertMember = db.prepare(
      `INSERT INTO member (platform_id, account_name, group_nickname, avatar, roles) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(platform_id) DO UPDATE SET
         account_name = COALESCE(NULLIF(excluded.account_name, ''), account_name),
         group_nickname = COALESCE(NULLIF(excluded.group_nickname, ''), group_nickname),
         avatar = COALESCE(NULLIF(excluded.avatar, ''), avatar),
         roles = CASE WHEN excluded.roles != '[]' THEN excluded.roles ELSE roles END`
    )
    const getMemberId = db.prepare('SELECT id FROM member WHERE platform_id = ?')
    const existingMemberIds = new Set(
      (db.prepare('SELECT platform_id FROM member').all() as Array<{ platform_id: string }>).map((r) => r.platform_id)
    )

    db.transaction(() => {
      for (const m of payload.members!) {
        const existed = existingMemberIds.has(m.platformId)
        const accountName = normalizeSenderAccountName(m.platformId, m.accountName)
        const groupNickname = normalizeSenderGroupNickname(m.platformId, m.groupNickname)
        upsertMember.run(
          m.platformId,
          accountName || null,
          groupNickname || null,
          m.avatar || null,
          m.roles ? JSON.stringify(m.roles) : '[]'
        )
        if (!existed) {
          membersAdded++
          const row = getMemberId.get(m.platformId) as { id: number } | undefined
          if (row) existingMemberIds.add(m.platformId)
        } else {
          membersUpdated++
        }
      }
    })
  }

  // Capture existing max timestamp before writing to detect backfill batches.
  const preWriteMaxTs =
    (db.prepare('SELECT MAX(ts) as max_ts FROM message').get() as { max_ts: number | null })?.max_ts ?? 0

  const { writtenCount, duplicateCount, minWrittenTs, ftsEntries } = writeMessages(db, payload.messages!, dedupState)

  if (ftsEntries.length > 0) {
    try {
      insertFtsEntries(db, ftsEntries)
    } catch {
      /* non-fatal */
    }
  }

  if (writtenCount > 0) {
    try {
      // Use minWrittenTs (not payload min) to avoid false-positive backfill detection
      // when overlap duplicates in the batch have older timestamps than written rows.
      if (minWrittenTs < preWriteMaxTs) {
        generateSessionIndex(db)
      } else {
        generateIncrementalSessionIndex(db)
      }
    } catch {
      /* non-fatal */
    }
  }

  if (!metaUpdated) {
    db.prepare('UPDATE meta SET imported_at = ?').run(Math.floor(Date.now() / 1000))
  }

  return { writtenCount, duplicateCount, metaUpdated, membersAdded, membersUpdated }
}

export async function pushImport(
  dbManager: DatabaseManager,
  sessionId: string,
  payload: PushImportPayload
): Promise<PushImportOutcome> {
  try {
    return await withDataDirImportLock(dbManager.getUserDataDir(), async () => {
      const outcome = await executePushImportUnlocked(
        {
          getDbPath: (id) => dbManager.getDbPath(id),
          openDatabase: (id, options) => dbManager.openRawSessionDatabase(id, options),
          deleteDatabase: (id) => {
            dbManager.deleteSessionDatabaseFiles(id)
          },
        },
        sessionId,
        payload
      )
      if (!outcome.ok) return outcome

      try {
        dbManager.raiseCurrentChatDbCompatibilityGate()
      } catch (error) {
        if (outcome.result.created) dbManager.deleteSessionDatabaseFiles(sessionId)
        throw error
      }
      return outcome
    })
  } catch (error) {
    if (error instanceof ImportInProgressError) {
      return {
        ok: false,
        reason: 'import_in_progress',
        message: 'Another import is already in progress',
      }
    }
    throw error
  }
}

/**
 * 执行已加锁的 Push Import 写库流程。调用方必须负责数据目录导入锁和兼容门禁，
 * 这样 CLI/Internal 可使用 DatabaseManager，Desktop 则可安全地在 worker 中执行写库。
 */
export async function executePushImportUnlocked(
  deps: PushImportExecutionDeps,
  sessionId: string,
  payload: PushImportPayload
): Promise<PushImportOutcome> {
  if (!isValidImportSessionId(sessionId)) {
    return { ok: false, reason: 'invalid_payload', message: 'sessionId contains invalid characters' }
  }

  const dbPath = deps.getDbPath(sessionId)
  const isNew = !fs.existsSync(dbPath)

  const validationError = validatePayload(payload, isNew)
  if (validationError) {
    return { ok: false, reason: 'invalid_payload', message: validationError }
  }

  try {
    if (isNew) {
      const db = deps.openDatabase(sessionId, { create: true })
      try {
        const { writtenCount, duplicateCount, membersAdded } = fullImport(
          db,
          payload.meta!,
          payload.members ?? [],
          payload.messages!
        )
        const session = queryStats(db)
        const outcome: PushImportOutcome = {
          ok: true,
          result: {
            sessionId,
            created: true,
            batch: { receivedCount: payload.messages!.length, writtenCount, duplicateCount },
            session,
            updates: { metaUpdated: true, membersAdded, membersUpdated: 0 },
          },
        }
        appLogger.info('push-import', 'Push import completed', outcome.result)
        return outcome
      } finally {
        db.close()
      }
    }

    const db = deps.openDatabase(sessionId, { readonly: false })
    try {
      const { writtenCount, duplicateCount, metaUpdated, membersAdded, membersUpdated } = incrementalImport(db, payload)
      const session = queryStats(db)
      const outcome: PushImportOutcome = {
        ok: true,
        result: {
          sessionId,
          created: false,
          batch: { receivedCount: payload.messages!.length, writtenCount, duplicateCount },
          session,
          updates: { metaUpdated, membersAdded, membersUpdated },
        },
      }
      appLogger.info('push-import', 'Push import completed', outcome.result)
      return outcome
    } finally {
      db.close()
    }
  } catch (err: unknown) {
    // Let DataDirCompatibilityError propagate so the Fastify error handler
    // maps it to 409 DATA_DIR_INCOMPATIBLE (consistent with other routes).
    if (err instanceof DataDirCompatibilityError) throw err

    if (isNew) {
      try {
        deps.deleteDatabase(sessionId)
      } catch {
        /* cleanup best-effort */
      }
    }
    appLogger.error('push-import', 'Push import failed', err)
    return { ok: false, reason: 'import_failed', message: err instanceof Error ? err.message : String(err) }
  }
}
