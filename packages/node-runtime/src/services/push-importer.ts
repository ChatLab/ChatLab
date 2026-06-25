/**
 * Push import service — handles POST /api/v1/imports/:sessionId
 *
 * Accepts a ChatLab Format JSON payload, creates or appends to a session.
 * Dedup: platformMessageId (preferred) or content hash (fallback).
 */

import * as fs from 'fs'
import { DataDirCompatibilityError } from '../data-dir-compat'
import {
  CHAT_DB_SCHEMA,
  generateMessageKey,
  generateSessionIndex,
  generateIncrementalSessionIndex,
} from '@openchatlab/core'
import type { DatabaseAdapter } from '@openchatlab/core'
import type { DatabaseManager } from '../database-manager'
import { buildFtsIndex, insertFtsEntries } from '../fts'
import { writeParseResultToDb } from '../import'

// Per-session lock: concurrent imports to different sessions are fine (separate DB files).
const importInProgress = new Set<string>()

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

function validatePayload(payload: PushImportPayload, isNew: boolean): string | null {
  const messages = payload.messages
  if (!messages || messages.length === 0) return 'messages is required and must contain at least one message'

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

  if (payload.members) {
    for (let i = 0; i < payload.members.length; i++) {
      if (!payload.members[i].platformId) return `members[${i}].platformId is required`
    }
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (!msg.sender) return `messages[${i}].sender is required`
    if (typeof msg.timestamp !== 'number' || msg.timestamp <= 0)
      return `messages[${i}].timestamp must be a positive number`
    if (typeof msg.type !== 'number') return `messages[${i}].type must be a number`
    if (msg.content !== undefined && msg.content !== null && typeof msg.content !== 'string')
      return `messages[${i}].content must be a string or null`
    if (msg.platformMessageId !== undefined && typeof msg.platformMessageId !== 'string')
      return `messages[${i}].platformMessageId must be a string`
  }

  return null
}

function queryStats(db: DatabaseAdapter): PushImportResult['session'] {
  const row = db.prepare('SELECT COUNT(*) as total, MIN(ts) as first, MAX(ts) as last FROM message').get() as {
    total: number
    first: number | null
    last: number | null
  }
  const memberRow = db.prepare('SELECT COUNT(*) as cnt FROM member').get() as { cnt: number }
  return { totalCount: row.total, memberCount: memberRow.cnt, firstTimestamp: row.first, lastTimestamp: row.last }
}

function writeMessages(
  db: DatabaseAdapter,
  messages: PushImportMessage[],
  existingPmids: Set<string>,
  existingKeys: Set<string>
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
      if (msg.platformMessageId) {
        if (existingPmids.has(msg.platformMessageId)) {
          duplicateCount++
          continue
        }
        existingPmids.add(msg.platformMessageId)
        // Also register the content hash so a same-content no-pmid copy later
        // in this batch is caught by the fallback dedup path.
        existingKeys.add(generateMessageKey(msg.timestamp, msg.sender, msg.content ?? null))
      } else {
        const key = generateMessageKey(msg.timestamp, msg.sender, msg.content ?? null)
        if (existingKeys.has(key)) {
          duplicateCount++
          continue
        }
        existingKeys.add(key)
      }

      let memberId = memberIdCache.get(msg.sender)
      if (!memberId) {
        insertMinimalMember.run(msg.sender, msg.accountName || null)
        const row = getMemberId.get(msg.sender) as { id: number } | undefined
        if (row) {
          memberId = row.id
          memberIdCache.set(msg.sender, memberId)
        }
      }
      if (!memberId) continue

      const result = insertMsg.run(
        memberId,
        msg.accountName || null,
        msg.groupNickname || null,
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
      extraMembers.push({ platformId: msg.sender, accountName: msg.accountName })
      knownIds.add(msg.sender)
    }
  }
  const allMembers = extraMembers.length > 0 ? [...members, ...extraMembers] : members

  // Deduplicate within the batch using the same pmid/hash logic as incremental imports.
  const pmids = new Set<string>()
  const hashKeys = new Set<string>()
  let duplicateCount = 0
  const dedupedMessages: PushImportMessage[] = []
  for (const msg of messages) {
    if (msg.platformMessageId) {
      if (pmids.has(msg.platformMessageId)) {
        duplicateCount++
        continue
      }
      pmids.add(msg.platformMessageId)
    } else {
      const key = generateMessageKey(msg.timestamp, msg.sender, msg.content ?? null)
      if (hashKeys.has(key)) {
        duplicateCount++
        continue
      }
      hashKeys.add(key)
    }
    dedupedMessages.push(msg)
  }

  // Delegate to the shared writer so member_name_history is tracked correctly,
  // matching the behaviour of file-based full imports.
  const stats = writeParseResultToDb(
    db,
    meta,
    allMembers.map((m) => ({ ...m, accountName: m.accountName ?? m.platformId })),
    dedupedMessages.map((m) => ({
      senderPlatformId: m.sender,
      senderAccountName: m.accountName ?? m.sender,
      senderGroupNickname: m.groupNickname,
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
  ;(
    db.prepare('SELECT platform_message_id FROM message WHERE platform_message_id IS NOT NULL').all() as Array<{
      platform_message_id: string
    }>
  ).forEach((r) => existingPmids.add(r.platform_message_id))
  // Load hashes for ALL existing messages (not just those without pmid) so that
  // messages previously imported with a platformMessageId are still caught by
  // content-hash dedup when the same content arrives without one.
  ;(
    db
      .prepare(`SELECT msg.ts, m.platform_id, msg.content FROM message msg JOIN member m ON msg.sender_id = m.id`)
      .all() as Array<{ ts: number; platform_id: string; content: string | null }>
  ).forEach((r) => existingKeys.add(generateMessageKey(r.ts, r.platform_id, r.content)))

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
        upsertMember.run(
          m.platformId,
          m.accountName || null,
          m.groupNickname || null,
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

  const { writtenCount, duplicateCount, minWrittenTs, ftsEntries } = writeMessages(
    db,
    payload.messages!,
    existingPmids,
    existingKeys
  )

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

// Only allow characters that are safe as a bare filename component.
// Rejects path separators (/ \), dots-only sequences (..), and control chars.
const SAFE_SESSION_ID_RE = /^[a-zA-Z0-9_@-][a-zA-Z0-9_@.-]*$/

export async function pushImport(
  dbManager: DatabaseManager,
  sessionId: string,
  payload: PushImportPayload
): Promise<PushImportOutcome> {
  if (!SAFE_SESSION_ID_RE.test(sessionId) || sessionId.includes('..')) {
    return { ok: false, reason: 'invalid_payload', message: 'sessionId contains invalid characters' }
  }

  if (importInProgress.has(sessionId)) {
    return {
      ok: false,
      reason: 'import_in_progress',
      message: 'Another import is already in progress for this session',
    }
  }

  const dbPath = dbManager.getDbPath(sessionId)
  const isNew = !fs.existsSync(dbPath)

  const validationError = validatePayload(payload, isNew)
  if (validationError) {
    return { ok: false, reason: 'invalid_payload', message: validationError }
  }

  importInProgress.add(sessionId)
  try {
    if (isNew) {
      const db = dbManager.openRawSessionDatabase(sessionId, { create: true })
      try {
        const { writtenCount, duplicateCount, membersAdded } = fullImport(
          db,
          payload.meta!,
          payload.members ?? [],
          payload.messages!
        )
        const session = queryStats(db)
        dbManager.raiseCurrentChatDbCompatibilityGate()
        return {
          ok: true,
          result: {
            sessionId,
            created: true,
            batch: { receivedCount: payload.messages!.length, writtenCount, duplicateCount },
            session,
            updates: { metaUpdated: true, membersAdded, membersUpdated: 0 },
          },
        }
      } finally {
        db.close()
      }
    }

    const db = dbManager.openRawSessionDatabase(sessionId, { readonly: false })
    try {
      const { writtenCount, duplicateCount, metaUpdated, membersAdded, membersUpdated } = incrementalImport(db, payload)
      const session = queryStats(db)
      dbManager.raiseCurrentChatDbCompatibilityGate()
      return {
        ok: true,
        result: {
          sessionId,
          created: false,
          batch: { receivedCount: payload.messages!.length, writtenCount, duplicateCount },
          session,
          updates: { metaUpdated, membersAdded, membersUpdated },
        },
      }
    } finally {
      db.close()
    }
  } catch (err: unknown) {
    // Let DataDirCompatibilityError propagate so the Fastify error handler
    // maps it to 409 DATA_DIR_INCOMPATIBLE (consistent with other routes).
    if (err instanceof DataDirCompatibilityError) throw err

    if (isNew) {
      try {
        dbManager.deleteSessionDatabaseFiles(sessionId)
      } catch {
        /* cleanup best-effort */
      }
    }
    return { ok: false, reason: 'import_failed', message: err instanceof Error ? err.message : String(err) }
  } finally {
    importInProgress.delete(sessionId)
  }
}
