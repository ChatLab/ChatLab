/**
 * Temporary database manager for merge operations.
 *
 * Extracted from electron/main/merger/tempCache.ts.
 * Uses DatabaseAdapter for platform-agnostic temp DB read/write.
 *
 * Callers provide a DatabaseAdapter factory; TempDbWriter/TempDbReader
 * handle schema creation and streaming reads.
 */

import * as fs from 'fs'
import * as path from 'path'
import type { DatabaseAdapter } from '@openchatlab/core'
import { CHATLAB_FORMAT_VERSION, type ParsedMember, type ParsedMessage } from '@openchatlab/shared-types'
import type { MergerDataSource, MergerSourceMeta } from './index'
import type { MergerMember, MergerMessage } from '@openchatlab/core'

// ==================== Temp DB schema (simplified for merge preview) ====================

export const TEMP_DB_SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    type TEXT NOT NULL,
    group_id TEXT,
    group_avatar TEXT,
    owner_id TEXT
  );

  CREATE TABLE IF NOT EXISTS member (
    platform_id TEXT PRIMARY KEY,
    account_name TEXT,
    group_nickname TEXT,
    avatar TEXT
  );

  CREATE TABLE IF NOT EXISTS message (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_platform_id TEXT NOT NULL,
    sender_account_name TEXT,
    sender_group_nickname TEXT,
    timestamp INTEGER NOT NULL,
    type INTEGER NOT NULL,
    content TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_message_ts ON message(timestamp);
  CREATE INDEX IF NOT EXISTS idx_message_sender ON message(sender_platform_id);
`

// ==================== TempDbWriter ====================

export class TempDbWriter {
  private db: DatabaseAdapter
  private memberSet = new Set<string>()
  private messageCount = 0

  constructor(db: DatabaseAdapter) {
    this.db = db
    db.exec(TEMP_DB_SCHEMA)
    db.exec('BEGIN TRANSACTION')
  }

  writeMeta(meta: {
    name: string
    platform: string
    type: string | number
    groupId?: string
    groupAvatar?: string
    ownerId?: string
  }): void {
    this.db
      .prepare('INSERT INTO meta (name, platform, type, group_id, group_avatar, owner_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(meta.name, meta.platform, meta.type, meta.groupId || null, meta.groupAvatar || null, meta.ownerId || null)
  }

  writeMembers(members: ParsedMember[]): void {
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO member (platform_id, account_name, group_nickname, avatar) VALUES (?, ?, ?, ?)'
    )
    for (const m of members) {
      if (!this.memberSet.has(m.platformId)) {
        this.memberSet.add(m.platformId)
        insert.run(m.platformId, m.accountName || null, m.groupNickname || null, m.avatar || null)
      }
    }
  }

  writeMessages(messages: ParsedMessage[]): void {
    const insert = this.db.prepare(
      `INSERT INTO message (sender_platform_id, sender_account_name, sender_group_nickname, timestamp, type, content)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    const memberInsert = this.db.prepare(
      'INSERT OR IGNORE INTO member (platform_id, account_name, group_nickname, avatar) VALUES (?, ?, ?, ?)'
    )
    for (const msg of messages) {
      if (!this.memberSet.has(msg.senderPlatformId)) {
        this.memberSet.add(msg.senderPlatformId)
        memberInsert.run(msg.senderPlatformId, msg.senderAccountName || null, msg.senderGroupNickname || null, null)
      }
      insert.run(
        msg.senderPlatformId,
        msg.senderAccountName || null,
        msg.senderGroupNickname || null,
        msg.timestamp,
        msg.type,
        msg.content || null
      )
      this.messageCount++
    }
  }

  finish(): { messageCount: number; memberCount: number } {
    this.db.exec('COMMIT')
    const result = { messageCount: this.messageCount, memberCount: this.memberSet.size }
    this.db.close()
    return result
  }

  abort(): void {
    try {
      this.db.exec('ROLLBACK')
    } catch {
      /* ignore */
    }
    this.db.close()
  }
}

// ==================== TempDbReader ====================

export interface TempDbMeta {
  name: string
  platform: string
  type: string
  groupId?: string
  groupAvatar?: string
}

export class TempDbReader {
  private db: DatabaseAdapter

  constructor(db: DatabaseAdapter) {
    this.db = db
  }

  getMeta(): TempDbMeta | null {
    const row = this.db.prepare('SELECT * FROM meta LIMIT 1').get() as
      | { name: string; platform: string; type: string; group_id: string | null; group_avatar: string | null }
      | undefined
    if (!row) return null
    return {
      name: row.name,
      platform: row.platform,
      type: row.type,
      groupId: row.group_id || undefined,
      groupAvatar: row.group_avatar || undefined,
    }
  }

  getMembers(): ParsedMember[] {
    const rows = this.db.prepare('SELECT * FROM member').all() as Array<{
      platform_id: string
      account_name: string | null
      group_nickname: string | null
      avatar: string | null
    }>
    return rows.map((r) => ({
      platformId: r.platform_id,
      accountName: r.account_name || r.platform_id,
      groupNickname: r.group_nickname || undefined,
      avatar: r.avatar || undefined,
    }))
  }

  getMessageCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM message').get() as { count: number }
    return row.count
  }

  streamMessages(batchSize: number, callback: (messages: ParsedMessage[]) => void): void {
    const stmt = this.db.prepare(`
      SELECT sender_platform_id, sender_account_name, sender_group_nickname, timestamp, type, content
      FROM message ORDER BY timestamp ASC LIMIT ? OFFSET ?
    `)

    let offset = 0
    while (true) {
      const rows = stmt.all(batchSize, offset) as Array<{
        sender_platform_id: string
        sender_account_name: string | null
        sender_group_nickname: string | null
        timestamp: number
        type: number
        content: string | null
      }>

      if (rows.length === 0) break

      const messages: ParsedMessage[] = rows.map((r) => ({
        senderPlatformId: r.sender_platform_id,
        senderAccountName: r.sender_account_name || r.sender_platform_id,
        senderGroupNickname: r.sender_group_nickname || undefined,
        timestamp: r.timestamp,
        type: r.type as ParsedMessage['type'],
        content: r.content,
      }))

      callback(messages)
      offset += batchSize
    }
  }

  getAllMessages(): ParsedMessage[] {
    const rows = this.db
      .prepare(
        `SELECT sender_platform_id, sender_account_name, sender_group_nickname, timestamp, type, content
         FROM message ORDER BY timestamp ASC`
      )
      .all() as Array<{
      sender_platform_id: string
      sender_account_name: string | null
      sender_group_nickname: string | null
      timestamp: number
      type: number
      content: string | null
    }>

    return rows.map((r) => ({
      senderPlatformId: r.sender_platform_id,
      senderAccountName: r.sender_account_name || r.sender_platform_id,
      senderGroupNickname: r.sender_group_nickname || undefined,
      timestamp: r.timestamp,
      type: r.type as ParsedMessage['type'],
      content: r.content,
    }))
  }

  close(): void {
    this.db.close()
  }

  /** Wrap this reader as a MergerDataSource for use with merge algorithms. */
  toDataSource(): MergerDataSource {
    return createDataSourceFromReader(this)
  }
}

function createDataSourceFromReader(reader: TempDbReader): MergerDataSource {
  return {
    getMeta(): MergerSourceMeta | null {
      const meta = reader.getMeta()
      if (!meta) return null
      return {
        name: meta.name,
        platform: meta.platform,
        type: meta.type,
        groupId: meta.groupId,
        groupAvatar: meta.groupAvatar,
      }
    },
    getMembers(): MergerMember[] {
      return reader.getMembers().map((m) => ({
        platformId: m.platformId,
        accountName: m.accountName,
        groupNickname: m.groupNickname,
        avatar: m.avatar,
      }))
    },
    getMessageCount(): number {
      return reader.getMessageCount()
    },
    streamMessages(batchSize: number, callback: (messages: MergerMessage[]) => void): void {
      reader.streamMessages(batchSize, (messages) => {
        callback(
          messages.map((msg) => ({
            senderPlatformId: msg.senderPlatformId,
            senderAccountName: msg.senderAccountName,
            senderGroupNickname: msg.senderGroupNickname,
            timestamp: msg.timestamp,
            type: msg.type,
            content: msg.content,
          }))
        )
      })
    },
  }
}

// ==================== Session export ====================

export interface ExportedSession {
  chatlab: { version: typeof CHATLAB_FORMAT_VERSION; exportedAt: number; generator: string; description: string }
  meta: { name: string; platform: string; type: string; groupId?: string; groupAvatar?: string }
  members: Array<{ platformId: string; accountName: string; groupNickname?: string; avatar?: string }>
  messages: Array<{
    sender: string
    accountName: string
    groupNickname?: string
    timestamp: number
    type: number
    content: string | null
  }>
}

/**
 * Export a session DB to a ChatLab JSON structure (in memory).
 * Caller decides how to persist (write to file, send over HTTP, etc.).
 */
export function exportSessionToJson(db: DatabaseAdapter): ExportedSession {
  const meta = db.prepare('SELECT * FROM meta').get() as
    | { name: string; platform: string; type: string; group_id?: string; group_avatar?: string }
    | undefined

  if (!meta) throw new Error('Cannot read session meta')

  const members = db.prepare('SELECT platform_id, account_name, group_nickname, avatar FROM member').all() as Array<{
    platform_id: string
    account_name?: string
    group_nickname?: string
    avatar?: string
  }>

  const messages = db
    .prepare(
      `SELECT m.platform_id as sender, msg.sender_account_name as accountName,
              msg.sender_group_nickname as groupNickname, msg.ts as timestamp, msg.type, msg.content
       FROM message msg JOIN member m ON msg.sender_id = m.id ORDER BY msg.ts`
    )
    .all() as Array<{
    sender: string
    accountName?: string
    groupNickname?: string
    timestamp: number
    type: number
    content?: string
  }>

  return {
    chatlab: {
      version: CHATLAB_FORMAT_VERSION,
      exportedAt: Math.floor(Date.now() / 1000),
      generator: 'ChatLab Export',
      description: `Exported from session: ${meta.name}`,
    },
    meta: {
      name: meta.name,
      platform: meta.platform,
      type: meta.type,
      groupId: meta.group_id,
      groupAvatar: meta.group_avatar,
    },
    members: members.map((m) => ({
      platformId: m.platform_id,
      accountName: m.account_name || m.platform_id,
      groupNickname: m.group_nickname || undefined,
      avatar: m.avatar,
    })),
    messages: messages.map((msg) => ({
      sender: msg.sender,
      accountName: msg.accountName || msg.sender,
      groupNickname: msg.groupNickname || undefined,
      timestamp: msg.timestamp,
      type: msg.type,
      content: msg.content ?? null,
    })),
  }
}

// ==================== Filesystem cleanup helpers ====================

export function deleteTempDatabase(dbPath: string): void {
  try {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
    const walPath = dbPath + '-wal'
    const shmPath = dbPath + '-shm'
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath)
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath)
  } catch {
    /* best-effort cleanup */
  }
}

export function cleanupTempDatabases(tempDir: string): void {
  try {
    if (!fs.existsSync(tempDir)) return
    const files = fs.readdirSync(tempDir)
    for (const file of files) {
      if (file.startsWith('merge_') && file.endsWith('.db')) {
        deleteTempDatabase(path.join(tempDir, file))
      }
    }
  } catch {
    /* best-effort */
  }
}
