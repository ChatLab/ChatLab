/**
 * ChatLab 数据导入器
 *
 * 将解析后的数据写入 SQLite 数据库。
 * 支持新建导入和增量导入（基于 platform_message_id 或内容哈希去重）。
 */

import * as fs from 'fs'
import * as crypto from 'crypto'
import type { DatabaseAdapter } from '@openchatlab/core'
import { CHAT_DB_SCHEMA, FTS_TABLE_SCHEMA, generateMessageKey, buildMemberIdMap } from '@openchatlab/core'
import type { DatabaseManager } from '@openchatlab/node-runtime'
import { writeParseResultToDb } from '@openchatlab/node-runtime'
import type { ParsedData, ImportMessage } from './chatlab-reader'

export interface ImportResult {
  success: boolean
  sessionId: string
  created: boolean
  messageCount: number
  memberCount: number
  duplicateCount: number
  error?: string
}

export interface ImportOptions {
  sessionId?: string
  dryRun?: boolean
  nativeBinding?: string
}

function generateSessionId(): string {
  const ts = Date.now()
  const rand = crypto.randomBytes(4).toString('hex')
  return `chat_${ts}_${rand}`
}

/**
 * 新建导入：创建新的会话数据库并导入全部数据
 * Delegates to shared writeParseResultToDb for data writing + name history.
 */
function fullImport(
  db: DatabaseAdapter,
  data: ParsedData,
  onProgress?: (msg: string) => void
): { messageCount: number; memberCount: number; duplicateCount: number } {
  db.exec(CHAT_DB_SCHEMA)

  onProgress?.(`写入 ${data.members.length} 个成员, ${data.messages.length} 条消息...`)
  const stats = writeParseResultToDb(db, data.meta, data.members, data.messages)

  buildFts(db, onProgress)

  return { messageCount: stats.messageCount, memberCount: stats.memberCount, duplicateCount: stats.skippedCount }
}

/**
 * 增量导入：向已有数据库追加新消息，自动去重
 */
function incrementalImport(
  db: DatabaseAdapter,
  data: ParsedData,
  onProgress?: (msg: string) => void
): { messageCount: number; memberCount: number; duplicateCount: number } {
  onProgress?.('加载去重索引...')
  const existingKeys = new Set<string>()

  const existingPmids = db
    .prepare('SELECT platform_message_id FROM message WHERE platform_message_id IS NOT NULL')
    .all() as Array<{ platform_message_id: string }>
  for (const row of existingPmids) {
    existingKeys.add(`pmid:${row.platform_message_id}`)
  }

  const existingHashes = db
    .prepare(
      `SELECT msg.ts, m.platform_id, msg.content
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       WHERE msg.platform_message_id IS NULL`
    )
    .all() as Array<{ ts: number; platform_id: string; content: string | null }>
  for (const row of existingHashes) {
    existingKeys.add(`hash:${generateMessageKey(row.ts, row.platform_id, row.content)}`)
  }

  onProgress?.(`去重索引: ${existingKeys.size} 条已有消息`)

  const upsertMember = db.prepare(
    `INSERT INTO member (platform_id, account_name, group_nickname, avatar, roles)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(platform_id) DO UPDATE SET
       account_name = COALESCE(NULLIF(excluded.account_name, ''), account_name),
       group_nickname = COALESCE(excluded.group_nickname, group_nickname)`
  )

  let newMembers = 0
  for (const m of data.members) {
    const result = upsertMember.run(
      m.platformId,
      m.accountName || m.platformId,
      m.groupNickname || null,
      m.avatar || null,
      m.roles ? JSON.stringify(m.roles) : '[]'
    )
    if (result.changes > 0) newMembers++
  }

  const memberIdMap = buildMemberIdMap(db)

  const insertMsg = db.prepare(
    `INSERT INTO message (sender_id, sender_account_name, sender_group_nickname, ts, type, content, reply_to_message_id, platform_message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertMemberMinimal = db.prepare(`INSERT OR IGNORE INTO member (platform_id, account_name) VALUES (?, ?)`)

  let written = 0
  let duplicates = 0
  const BATCH = 5000

  for (let i = 0; i < data.messages.length; i += BATCH) {
    const batch = data.messages.slice(i, i + BATCH)
    db.transaction(() => {
      for (const msg of batch) {
        if (isDuplicate(msg, existingKeys)) {
          duplicates++
          continue
        }

        let senderId = memberIdMap.get(msg.senderPlatformId)
        if (!senderId) {
          insertMemberMinimal.run(msg.senderPlatformId, msg.senderAccountName || msg.senderPlatformId)
          senderId = (
            db.prepare('SELECT id FROM member WHERE platform_id = ?').get(msg.senderPlatformId) as { id: number }
          )?.id
          if (senderId) memberIdMap.set(msg.senderPlatformId, senderId)
        }
        if (!senderId) continue

        insertMsg.run(
          senderId,
          msg.senderAccountName || null,
          msg.senderGroupNickname || null,
          msg.timestamp,
          msg.type,
          msg.content,
          msg.replyToMessageId || null,
          msg.platformMessageId || null
        )
        written++
      }
    })

    if (onProgress && (i + BATCH) % 50000 < BATCH) {
      onProgress(
        `已处理 ${Math.min(i + BATCH, data.messages.length)} / ${data.messages.length} 条消息 (新增 ${written}, 重复 ${duplicates})`
      )
    }
  }

  if (written > 0) {
    insertFtsEntries(db, onProgress)
    db.prepare('UPDATE meta SET imported_at = ?').run(Math.floor(Date.now() / 1000))
  }

  return { messageCount: written, memberCount: newMembers, duplicateCount: duplicates }
}

function isDuplicate(msg: ImportMessage, existingKeys: Set<string>): boolean {
  if (msg.platformMessageId) {
    return existingKeys.has(`pmid:${msg.platformMessageId}`)
  }
  const key = generateMessageKey(msg.timestamp, msg.senderPlatformId, msg.content)
  return existingKeys.has(`hash:${key}`)
}

function buildFts(db: DatabaseAdapter, onProgress?: (msg: string) => void): void {
  onProgress?.('创建全文搜索索引...')
  db.exec(FTS_TABLE_SCHEMA)

  const textMessages = db
    .prepare("SELECT id, content FROM message WHERE type = 0 AND content IS NOT NULL AND content != ''")
    .all() as Array<{ id: number; content: string }>

  const insertFts = db.prepare('INSERT INTO message_fts(rowid, content) VALUES (?, ?)')
  const BATCH = 5000
  for (let i = 0; i < textMessages.length; i += BATCH) {
    const batch = textMessages.slice(i, i + BATCH)
    db.transaction(() => {
      for (const row of batch) {
        insertFts.run(row.id, row.content)
      }
    })
  }
}

function insertFtsEntries(db: DatabaseAdapter, onProgress?: (msg: string) => void): void {
  try {
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='message_fts'").get()
  } catch {
    return
  }

  const hasFts = db
    .prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='message_fts'")
    .get() as { cnt: number }
  if (!hasFts || hasFts.cnt === 0) return

  onProgress?.('更新全文搜索索引...')
  const maxRowid = (db.prepare('SELECT MAX(rowid) as m FROM message_fts').get() as { m: number | null })?.m ?? 0
  const newRows = db
    .prepare("SELECT id, content FROM message WHERE type = 0 AND content IS NOT NULL AND content != '' AND id > ?")
    .all(maxRowid) as Array<{ id: number; content: string }>

  if (newRows.length === 0) return

  const insertFts = db.prepare('INSERT INTO message_fts(rowid, content) VALUES (?, ?)')
  db.transaction(() => {
    for (const row of newRows) {
      insertFts.run(row.id, row.content)
    }
  })
}

/**
 * 执行导入（新建或增量）
 */
export async function importData(
  dbManager: DatabaseManager,
  data: ParsedData,
  options?: ImportOptions & { onProgress?: (msg: string) => void }
): Promise<ImportResult> {
  const sessionId = options?.sessionId || generateSessionId()
  const dbPath = dbManager.getDbPath(sessionId)
  const exists = fs.existsSync(dbPath)

  if (options?.dryRun) {
    if (exists) {
      const db = dbManager.open(sessionId)
      if (!db)
        return {
          success: false,
          sessionId,
          created: false,
          messageCount: 0,
          memberCount: 0,
          duplicateCount: 0,
          error: 'Failed to open database',
        }

      const existingCount = (db.prepare('SELECT COUNT(*) as cnt FROM message').get() as { cnt: number }).cnt
      return {
        success: true,
        sessionId,
        created: false,
        messageCount: data.messages.length,
        memberCount: data.members.length,
        duplicateCount: 0,
        error: `Dry run: ${data.messages.length} messages to import into existing session (${existingCount} existing messages)`,
      }
    }
    return {
      success: true,
      sessionId,
      created: true,
      messageCount: data.messages.length,
      memberCount: data.members.length,
      duplicateCount: 0,
      error: `Dry run: would create new session with ${data.messages.length} messages`,
    }
  }

  try {
    if (exists) {
      const db = dbManager.openRawSessionDatabase(sessionId, { readonly: false })
      let result: { messageCount: number; memberCount: number; duplicateCount: number }
      try {
        result = incrementalImport(db, data, options?.onProgress)
      } finally {
        db.close()
      }
      dbManager.raiseCurrentChatDbCompatibilityGate()
      return { success: true, sessionId, created: false, ...result }
    }

    const db = dbManager.openRawSessionDatabase(sessionId, { create: true })
    let result: { messageCount: number; memberCount: number; duplicateCount: number }
    try {
      result = fullImport(db, data, options?.onProgress)
    } finally {
      db.close()
    }
    dbManager.raiseCurrentChatDbCompatibilityGate()
    return { success: true, sessionId, created: true, ...result }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    if (!exists) {
      dbManager.deleteSessionDatabaseFiles(sessionId)
    }
    return {
      success: false,
      sessionId,
      created: false,
      messageCount: 0,
      memberCount: 0,
      duplicateCount: 0,
      error: message,
    }
  }
}
