/**
 * 数据库核心模块
 * 负责数据库的创建、打开、关闭和数据导入
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import type { ParseResult } from '../../../src/types/base'
import { migrateDatabase, needsMigration, CURRENT_SCHEMA_VERSION } from './migrations'
import { getDatabaseDir, getCacheDir, ensureDir } from '../paths'
import { deleteSessionCache } from './sessionCache'

/**
 * 获取数据库目录
 */
function getDbDir(): string {
  return getDatabaseDir()
}

/**
 * 确保数据库目录存在
 */
function ensureDbDir(): void {
  ensureDir(getDbDir())
}

/**
 * 生成唯一的会话ID
 */
function generateSessionId(): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  return `chat_${timestamp}_${random}`
}

/**
 * 获取数据库文件路径
 */
export function getDbPath(sessionId: string): string {
  return path.join(getDbDir(), `${sessionId}.db`)
}

/**
 * 创建新数据库并初始化表结构
 */
function createDatabase(sessionId: string): Database.Database {
  ensureDbDir()
  const dbPath = getDbPath(sessionId)
  const db = new Database(dbPath)

  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      group_id TEXT,
      group_avatar TEXT,
      owner_id TEXT,
      schema_version INTEGER DEFAULT ${CURRENT_SCHEMA_VERSION},
      session_gap_threshold INTEGER
    );

    CREATE TABLE IF NOT EXISTS member (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL UNIQUE,
      account_name TEXT,
      group_nickname TEXT,
      aliases TEXT DEFAULT '[]',
      avatar TEXT,
      roles TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS member_name_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      name_type TEXT NOT NULL,
      name TEXT NOT NULL,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER,
      FOREIGN KEY(member_id) REFERENCES member(id)
    );

    CREATE TABLE IF NOT EXISTS message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      sender_account_name TEXT,
      sender_group_nickname TEXT,
      ts INTEGER NOT NULL,
      type INTEGER NOT NULL,
      content TEXT,
      reply_to_message_id TEXT DEFAULT NULL,
      platform_message_id TEXT DEFAULT NULL,
      FOREIGN KEY(sender_id) REFERENCES member(id)
    );

    CREATE TABLE IF NOT EXISTS chat_session (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER NOT NULL,
      message_count INTEGER DEFAULT 0,
      is_manual INTEGER DEFAULT 0,
      summary TEXT
    );

    CREATE TABLE IF NOT EXISTS message_context (
      message_id INTEGER PRIMARY KEY,
      session_id INTEGER NOT NULL,
      topic_id INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_message_ts ON message(ts);
    CREATE INDEX IF NOT EXISTS idx_message_sender ON message(sender_id);
    CREATE INDEX IF NOT EXISTS idx_message_platform_id ON message(platform_message_id);
    CREATE INDEX IF NOT EXISTS idx_member_name_history_member_id ON member_name_history(member_id);
    CREATE INDEX IF NOT EXISTS idx_session_time ON chat_session(start_ts, end_ts);
    CREATE INDEX IF NOT EXISTS idx_context_session ON message_context(session_id);
  `)

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
      content,
      content='',
      content_rowid=id
    )
  `)

  return db
}

/**
 * 打开已存在的数据库
 * @param readonly 是否只读模式（默认 true）
 */
export function openDatabase(sessionId: string, readonly = true): Database.Database | null {
  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) {
    return null
  }
  const db = new Database(dbPath, { readonly })
  db.pragma('journal_mode = WAL')
  return db
}

/**
 * 打开数据库并执行迁移（如果需要）
 * 用于需要写入的场景
 * @param sessionId 会话ID
 * @param forceRepair 是否强制修复（即使版本号已是最新也重新执行迁移脚本）
 */
export function openDatabaseWithMigration(sessionId: string, forceRepair = false): Database.Database | null {
  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) {
    return null
  }

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  // 执行迁移
  migrateDatabase(db, forceRepair)

  return db
}

/**
 * 导入解析后的数据到数据库
 */
export function importData(parseResult: ParseResult): string {
  const sessionId = generateSessionId()
  const db = createDatabase(sessionId)

  try {
    const importTransaction = db.transaction(() => {
      const insertMeta = db.prepare(`
        INSERT INTO meta (name, platform, type, imported_at, group_id, group_avatar, owner_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      insertMeta.run(
        parseResult.meta.name,
        parseResult.meta.platform,
        parseResult.meta.type,
        Math.floor(Date.now() / 1000),
        parseResult.meta.groupId || null,
        parseResult.meta.groupAvatar || null,
        parseResult.meta.ownerId || null
      )

      const insertMember = db.prepare(`
        INSERT OR IGNORE INTO member (platform_id, account_name, group_nickname, avatar, roles) VALUES (?, ?, ?, ?, ?)
      `)
      const getMemberId = db.prepare(`
        SELECT id FROM member WHERE platform_id = ?
      `)

      const memberIdMap = new Map<string, number>()

      for (const member of parseResult.members) {
        insertMember.run(
          member.platformId,
          member.accountName || null,
          member.groupNickname || null,
          member.avatar || null,
          member.roles ? JSON.stringify(member.roles) : '[]'
        )
        const row = getMemberId.get(member.platformId) as { id: number }
        memberIdMap.set(member.platformId, row.id)
      }

      const sortedMessages = [...parseResult.messages].sort((a, b) => a.timestamp - b.timestamp)
      // 分别追踪 account_name 和 group_nickname 的变化
      const accountNameTracker = new Map<string, { currentName: string; lastSeenTs: number }>()
      const groupNicknameTracker = new Map<string, { currentName: string; lastSeenTs: number }>()

      const insertMessage = db.prepare(`
        INSERT INTO message (sender_id, sender_account_name, sender_group_nickname, ts, type, content, reply_to_message_id, platform_message_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const insertNameHistory = db.prepare(`
        INSERT INTO member_name_history (member_id, name_type, name, start_ts, end_ts)
        VALUES (?, ?, ?, ?, ?)
      `)
      const updateMemberAccountName = db.prepare(`
        UPDATE member SET account_name = ? WHERE platform_id = ?
      `)
      const updateMemberGroupNickname = db.prepare(`
        UPDATE member SET group_nickname = ? WHERE platform_id = ?
      `)
      const updateNameHistoryEndTs = db.prepare(`
        UPDATE member_name_history
        SET end_ts = ?
        WHERE member_id = ? AND name_type = ? AND end_ts IS NULL
      `)

      for (const msg of sortedMessages) {
        const senderId = memberIdMap.get(msg.senderPlatformId)
        if (senderId === undefined) continue

        insertMessage.run(
          senderId,
          msg.senderAccountName || null,
          msg.senderGroupNickname || null,
          msg.timestamp,
          msg.type,
          msg.content,
          msg.replyToMessageId || null,
          msg.platformMessageId || null
        )

        // 追踪 account_name 变化
        const accountName = msg.senderAccountName
        if (accountName) {
          const tracker = accountNameTracker.get(msg.senderPlatformId)
          if (!tracker) {
            accountNameTracker.set(msg.senderPlatformId, {
              currentName: accountName,
              lastSeenTs: msg.timestamp,
            })
            insertNameHistory.run(senderId, 'account_name', accountName, msg.timestamp, null)
          } else if (tracker.currentName !== accountName) {
            updateNameHistoryEndTs.run(msg.timestamp, senderId, 'account_name')
            insertNameHistory.run(senderId, 'account_name', accountName, msg.timestamp, null)
            tracker.currentName = accountName
            tracker.lastSeenTs = msg.timestamp
          } else {
            tracker.lastSeenTs = msg.timestamp
          }
        }

        // 追踪 group_nickname 变化
        const groupNickname = msg.senderGroupNickname
        if (groupNickname) {
          const tracker = groupNicknameTracker.get(msg.senderPlatformId)
          if (!tracker) {
            groupNicknameTracker.set(msg.senderPlatformId, {
              currentName: groupNickname,
              lastSeenTs: msg.timestamp,
            })
            insertNameHistory.run(senderId, 'group_nickname', groupNickname, msg.timestamp, null)
          } else if (tracker.currentName !== groupNickname) {
            updateNameHistoryEndTs.run(msg.timestamp, senderId, 'group_nickname')
            insertNameHistory.run(senderId, 'group_nickname', groupNickname, msg.timestamp, null)
            tracker.currentName = groupNickname
            tracker.lastSeenTs = msg.timestamp
          } else {
            tracker.lastSeenTs = msg.timestamp
          }
        }
      }

      // 更新成员最新的 account_name 和 group_nickname
      for (const [platformId, tracker] of accountNameTracker.entries()) {
        updateMemberAccountName.run(tracker.currentName, platformId)
      }
      for (const [platformId, tracker] of groupNicknameTracker.entries()) {
        updateMemberGroupNickname.run(tracker.currentName, platformId)
      }
    })

    importTransaction()
    return sessionId
  } catch (error) {
    console.error('[Database] Error in importData:', error)
    throw error
  } finally {
    db.close()
  }
}

/**
 * 更新会话的 ownerId
 */
export function updateSessionOwnerId(sessionId: string, ownerId: string | null): boolean {
  // 使用带迁移的打开方式，确保 owner_id 列存在
  const db = openDatabaseWithMigration(sessionId)
  if (!db) {
    return false
  }

  try {
    const stmt = db.prepare('UPDATE meta SET owner_id = ?')
    stmt.run(ownerId)
    return true
  } catch (error) {
    console.error('[Database] Failed to update session ownerId:', error)
    return false
  } finally {
    db.close()
  }
}

/**
 * 删除会话
 */
export function deleteSession(sessionId: string): boolean {
  const dbPath = getDbPath(sessionId)
  const walPath = dbPath + '-wal'
  const shmPath = dbPath + '-shm'

  try {
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath)
    }
    if (fs.existsSync(walPath)) {
      fs.unlinkSync(walPath)
    }
    if (fs.existsSync(shmPath)) {
      fs.unlinkSync(shmPath)
    }
    deleteSessionCache(sessionId, getCacheDir())
    return true
  } catch (error) {
    console.error('[Database] Failed to delete session:', error)
    return false
  }
}

/**
 * 重命名会话
 */
export function renameSession(sessionId: string, newName: string): boolean {
  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) {
    return false
  }

  try {
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')

    const stmt = db.prepare('UPDATE meta SET name = ?')
    stmt.run(newName)

    db.close()
    return true
  } catch (error) {
    console.error('[Database] Failed to rename session:', error)
    return false
  }
}

/**
 * 获取数据库存储目录
 */
export function getDbDirectory(): string {
  ensureDbDir()
  return getDbDir()
}

/**
 * 检查是否有数据库需要迁移
 * @returns 需要迁移的数据库数量、列表、最低版本和需要强制修复的列表
 */
export function checkMigrationNeeded(): {
  count: number
  sessionIds: string[]
  lowestVersion: number
  forceRepairIds: string[]
} {
  ensureDbDir()
  const dbDir = getDbDir()
  const files = fs.readdirSync(dbDir).filter((f) => f.endsWith('.db'))
  const needsMigrationList: string[] = []
  const forceRepairList: string[] = []
  let lowestVersion = CURRENT_SCHEMA_VERSION

  for (const file of files) {
    const sessionId = file.replace('.db', '')
    const dbPath = getDbPath(sessionId)

    try {
      const db = new Database(dbPath, { readonly: true })
      db.pragma('journal_mode = WAL')

      // 仅迁移聊天会话数据库：这里最小依赖是 meta + message
      // 这样可跳过非聊天库，同时避免把 member 缺失的异常库直接误归为“非聊天库”
      const requiredTableCount = db
        .prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name IN ('meta', 'message')")
        .get() as { cnt: number }
      const isChatSessionDb = requiredTableCount.cnt === 2
      if (!isChatSessionDb) {
        db.close()
        continue
      }

      // 获取当前 schema_version
      const metaTableInfo = db.prepare('PRAGMA table_info(meta)').all() as Array<{ name: string }>
      const hasVersionColumn = metaTableInfo.some((col) => col.name === 'schema_version')
      let dbVersion = 0
      if (hasVersionColumn) {
        const result = db.prepare('SELECT schema_version FROM meta LIMIT 1').get() as
          | { schema_version: number | null }
          | undefined
        dbVersion = result?.schema_version ?? 0
      }

      // 检查 message 表是否有 reply_to_message_id 列
      const messageTableInfo = db.prepare('PRAGMA table_info(message)').all() as Array<{ name: string }>
      const hasReplyColumn = messageTableInfo.some((col) => col.name === 'reply_to_message_id')

      if (needsMigration(db)) {
        needsMigrationList.push(sessionId)
        lowestVersion = Math.min(lowestVersion, dbVersion)
      } else if (!hasReplyColumn) {
        // 特殊情况：版本号已更新但列不存在，需要强制修复
        needsMigrationList.push(sessionId)
        forceRepairList.push(sessionId)
        lowestVersion = Math.min(lowestVersion, dbVersion)
      }

      db.close()
    } catch (error) {
      console.error(`[Database] Failed to check migration for ${file}:`, error)
    }
  }

  return {
    count: needsMigrationList.length,
    sessionIds: needsMigrationList,
    lowestVersion,
    forceRepairIds: forceRepairList,
  }
}

/**
 * 迁移失败的数据库信息
 */
interface MigrationFailure {
  sessionId: string
  error: string
}

/**
 * 执行所有数据库的迁移
 * 即使部分数据库迁移失败，也会继续处理其他数据库
 * @returns 迁移结果，包含成功数量和失败列表
 */
export function migrateAllDatabases(): {
  success: boolean
  migratedCount: number
  failures: MigrationFailure[]
  error?: string
} {
  const { sessionIds, forceRepairIds } = checkMigrationNeeded()
  const forceRepairSet = new Set(forceRepairIds)

  if (sessionIds.length === 0) {
    return { success: true, migratedCount: 0, failures: [] }
  }

  let migratedCount = 0
  const failures: MigrationFailure[] = []

  for (const sessionId of sessionIds) {
    try {
      const needsForceRepair = forceRepairSet.has(sessionId)
      const db = openDatabaseWithMigration(sessionId, needsForceRepair)
      if (db) {
        db.close()
        migratedCount++
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`[Database] Failed to migrate ${sessionId}:`, errorMessage)
      failures.push({ sessionId, error: errorMessage })
    }
  }

  // 如果有失败的数据库，返回部分成功状态
  if (failures.length > 0) {
    const failedIds = failures.map((f) => f.sessionId.split('_').slice(-1)[0]).join(', ')
    return {
      success: false,
      migratedCount,
      failures,
      error: `${failures.length} 个数据库迁移失败（ID: ${failedIds}）。建议在侧边栏中删除这些损坏的会话。`,
    }
  }

  return { success: true, migratedCount, failures: [] }
}
