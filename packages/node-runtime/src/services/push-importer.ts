/**
 * Push import service — handles POST /api/v1/imports/:sessionId
 *
 * Accepts a ChatLab Format JSON payload, creates or appends to a session.
 * Dedup: platformMessageId (preferred) or content hash (fallback).
 */

import * as fs from 'fs'
import {
  CHAT_DB_SCHEMA,
  FTS_TABLE_SCHEMA,
  generateMessageKey,
  generateSessionIndex,
  generateIncrementalSessionIndex,
} from '@openchatlab/core'
import type { DatabaseAdapter } from '@openchatlab/core'
import type { DatabaseManager } from '../database-manager'
import { insertFtsEntries } from '../fts'

// ponytail: global lock — only one push import at a time per docs
let importInProgress = false

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

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (!msg.sender) return `messages[${i}].sender is required`
    if (typeof msg.timestamp !== 'number' || msg.timestamp <= 0)
      return `messages[${i}].timestamp must be a positive number`
    if (typeof msg.type !== 'number') return `messages[${i}].type must be a number`
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
): { writtenCount: number; duplicateCount: number; ftsEntries: Array<{ id: number; content: string | null }> } {
  const insertMsg = db.prepare(
    `INSERT INTO message (sender_id, sender_account_name, sender_group_nickname, ts, type, content, reply_to_message_id, platform_message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const getMemberId = db.prepare('SELECT id FROM member WHERE platform_id = ?')
  const insertMinimalMember = db.prepare('INSERT OR IGNORE INTO member (platform_id, account_name) VALUES (?, ?)')

  const memberIdCache = new Map<string, number>()
  let writtenCount = 0
  let duplicateCount = 0
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
      writtenCount++
    }
  })

  return { writtenCount, duplicateCount, ftsEntries }
}

function fullImport(
  db: DatabaseAdapter,
  meta: PushImportMeta,
  members: PushImportMember[],
  messages: PushImportMessage[]
): { writtenCount: number; duplicateCount: number; membersAdded: number } {
  db.exec(CHAT_DB_SCHEMA)

  const now = Math.floor(Date.now() / 1000)
  db.prepare(
    'INSERT INTO meta (name, platform, type, imported_at, group_id, group_avatar, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(meta.name, meta.platform, meta.type, now, meta.groupId || null, meta.groupAvatar || null, meta.ownerId || null)

  const insertMember = db.prepare(
    'INSERT OR IGNORE INTO member (platform_id, account_name, group_nickname, avatar, roles) VALUES (?, ?, ?, ?, ?)'
  )
  const getMemberId = db.prepare('SELECT id FROM member WHERE platform_id = ?')
  const memberIdMap = new Map<string, number>()

  db.transaction(() => {
    for (const m of members) {
      insertMember.run(
        m.platformId,
        m.accountName || null,
        m.groupNickname || null,
        m.avatar || null,
        m.roles ? JSON.stringify(m.roles) : '[]'
      )
      const row = getMemberId.get(m.platformId) as { id: number } | undefined
      if (row) memberIdMap.set(m.platformId, row.id)
    }
  })

  const { writtenCount, duplicateCount, ftsEntries } = writeMessages(db, messages, new Set(), new Set())

  if (ftsEntries.length > 0) {
    db.exec(FTS_TABLE_SCHEMA)
    insertFtsEntries(db, ftsEntries)
  }

  try {
    generateSessionIndex(db)
  } catch {
    /* non-fatal */
  }

  return { writtenCount, duplicateCount, membersAdded: members.length }
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
  ;(
    db
      .prepare(
        `SELECT msg.ts, m.platform_id, msg.content FROM message msg JOIN member m ON msg.sender_id = m.id WHERE msg.platform_message_id IS NULL`
      )
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

  const { writtenCount, duplicateCount, ftsEntries } = writeMessages(db, payload.messages!, existingPmids, existingKeys)

  if (ftsEntries.length > 0) {
    try {
      insertFtsEntries(db, ftsEntries)
    } catch {
      /* non-fatal */
    }
  }

  if (writtenCount > 0) {
    try {
      generateIncrementalSessionIndex(db)
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
  if (importInProgress) {
    return { ok: false, reason: 'import_in_progress', message: 'Another import is already in progress' }
  }

  const dbPath = dbManager.getDbPath(sessionId)
  const isNew = !fs.existsSync(dbPath)

  const validationError = validatePayload(payload, isNew)
  if (validationError) {
    return { ok: false, reason: 'invalid_payload', message: validationError }
  }

  importInProgress = true
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
    if (isNew) {
      try {
        dbManager.deleteSessionDatabaseFiles(sessionId)
      } catch {
        /* cleanup best-effort */
      }
    }
    return { ok: false, reason: 'import_failed', message: err instanceof Error ? err.message : String(err) }
  } finally {
    importInProgress = false
  }
}
