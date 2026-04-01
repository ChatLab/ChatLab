/**
 * 临时数据库缓存管理器
 * 用于合并功能：将解析结果存入临时 SQLite 数据库，避免内存溢出
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import { ChatType, type ParsedMember, type ParsedMessage } from '../../../src/types/base'
import type { ParsedMeta } from '../parser/types'
import { getTempDir as getAppTempDir, ensureDir } from '../paths'

/**
 * 获取临时数据库目录
 */
function getTempDir(): string {
  const dir = getAppTempDir()
  ensureDir(dir)
  return dir
}

/**
 * 生成临时数据库文件路径
 */
export function generateTempDbPath(sourceFilePath: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  const baseName = path.basename(sourceFilePath, path.extname(sourceFilePath))
  const safeName = baseName.replace(/[/\\?%*:|"<>]/g, '_').substring(0, 50)
  return path.join(getTempDir(), `merge_${safeName}_${timestamp}_${random}.db`)
}

/**
 * 创建临时数据库并初始化表结构
 */
export function createTempDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      group_id TEXT,
      group_avatar TEXT
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
  `)

  return db
}

/**
 * 临时数据库写入器
 * 用于流式写入解析结果
 */
export class TempDbWriter {
  private db: Database.Database
  private insertMeta: Database.Statement
  private insertMember: Database.Statement
  private insertMessage: Database.Statement
  private memberSet: Set<string> = new Set()
  private messageCount: number = 0

  constructor(dbPath: string) {
    this.db = createTempDatabase(dbPath)

    // 准备语句
    this.insertMeta = this.db.prepare(`
      INSERT INTO meta (name, platform, type, group_id, group_avatar) VALUES (?, ?, ?, ?, ?)
    `)
    this.insertMember = this.db.prepare(`
      INSERT OR IGNORE INTO member (platform_id, account_name, group_nickname, avatar) VALUES (?, ?, ?, ?)
    `)
    this.insertMessage = this.db.prepare(`
      INSERT INTO message (sender_platform_id, sender_account_name, sender_group_nickname, timestamp, type, content)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    // 开始事务
    this.db.exec('BEGIN TRANSACTION')
  }

  /**
   * 写入元信息
   */
  writeMeta(meta: ParsedMeta): void {
    this.insertMeta.run(meta.name, meta.platform, meta.type, meta.groupId || null, meta.groupAvatar || null)
  }

  /**
   * 写入成员（批量）
   */
  writeMembers(members: ParsedMember[]): void {
    for (const m of members) {
      if (!this.memberSet.has(m.platformId)) {
        this.memberSet.add(m.platformId)
        this.insertMember.run(m.platformId, m.accountName || null, m.groupNickname || null, m.avatar || null)
      }
    }
  }

  /**
   * 写入消息（批量）
   */
  writeMessages(messages: ParsedMessage[]): void {
    for (const msg of messages) {
      // 确保成员存在（消息中没有头像信息，设为 null）
      if (!this.memberSet.has(msg.senderPlatformId)) {
        this.memberSet.add(msg.senderPlatformId)
        this.insertMember.run(
          msg.senderPlatformId,
          msg.senderAccountName || null,
          msg.senderGroupNickname || null,
          null
        )
      }

      this.insertMessage.run(
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

  /**
   * 完成写入（提交事务）
   */
  finish(): { messageCount: number; memberCount: number } {
    this.db.exec('COMMIT')
    const result = {
      messageCount: this.messageCount,
      memberCount: this.memberSet.size,
    }
    this.db.close()
    return result
  }

  /**
   * 取消写入（回滚事务）
   */
  abort(): void {
    try {
      this.db.exec('ROLLBACK')
    } catch {
      // 忽略回滚错误
    }
    this.db.close()
  }
}

/**
 * 临时数据库读取器
 * 用于流式读取合并时的数据
 */
export class TempDbReader {
  private db: Database.Database
  private dbPath: string

  constructor(dbPath: string) {
    this.dbPath = dbPath
    this.db = new Database(dbPath, { readonly: true })
    this.db.pragma('journal_mode = WAL')
  }

  /**
   * 读取元信息
   */
  getMeta(): ParsedMeta | null {
    const row = this.db.prepare('SELECT * FROM meta LIMIT 1').get() as
      | { name: string; platform: string; type: string; group_id: string | null; group_avatar: string | null }
      | undefined
    if (!row) return null
    return {
      name: row.name,
      platform: row.platform,
      type: row.type === ChatType.PRIVATE ? ChatType.PRIVATE : ChatType.GROUP,
      groupId: row.group_id || undefined,
      groupAvatar: row.group_avatar || undefined,
    }
  }

  /**
   * 读取所有成员
   */
  getMembers(): ParsedMember[] {
    const rows = this.db.prepare('SELECT * FROM member').all() as Array<{
      platform_id: string
      account_name: string | null
      group_nickname: string | null
      avatar: string | null
    }>
    return rows.map((r) => ({
      platformId: r.platform_id,
      accountName: r.account_name || r.platform_id, // 如果没有账号名称，使用 platformId
      groupNickname: r.group_nickname || undefined,
      avatar: r.avatar || undefined,
    }))
  }

  /**
   * 获取消息总数
   */
  getMessageCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM message').get() as { count: number }
    return row.count
  }

  /**
   * 流式读取消息（分批）
   * @param batchSize 每批消息数量
   * @param callback 处理每批消息的回调
   */
  streamMessages(batchSize: number, callback: (messages: ParsedMessage[]) => void): void {
    const stmt = this.db.prepare(`
      SELECT sender_platform_id, sender_account_name, sender_group_nickname, timestamp, type, content
      FROM message
      ORDER BY timestamp ASC
      LIMIT ? OFFSET ?
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

  /**
   * 获取所有消息（用于冲突检测，内存中处理）
   * 注意：对于超大文件，应使用 streamMessages
   */
  getAllMessages(): ParsedMessage[] {
    const rows = this.db
      .prepare(
        `
      SELECT sender_platform_id, sender_account_name, sender_group_nickname, timestamp, type, content
      FROM message
      ORDER BY timestamp ASC
    `
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

  /**
   * 关闭数据库连接
   */
  close(): void {
    this.db.close()
  }

  /**
   * 获取数据库路径
   */
  getPath(): string {
    return this.dbPath
  }
}

/**
 * 删除临时数据库文件
 */
export function deleteTempDatabase(dbPath: string): void {
  try {
    const walPath = dbPath + '-wal'
    const shmPath = dbPath + '-shm'

    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath)
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath)

    console.log(`[TempCache] Deleted temp database: ${dbPath}`)
  } catch (error) {
    console.error(`[TempCache] Failed to delete temp database: ${dbPath}`, error)
  }
}

/**
 * 清理所有临时数据库（应用启动时调用）
 */
export function cleanupAllTempDatabases(): void {
  try {
    const dir = getTempDir()
    if (!fs.existsSync(dir)) return

    const files = fs.readdirSync(dir)
    for (const file of files) {
      if (file.startsWith('merge_') && file.endsWith('.db')) {
        const filePath = path.join(dir, file)
        deleteTempDatabase(filePath)
      }
    }
    console.log('[TempCache] Cleaned up all temp databases')
  } catch (error) {
    console.error('[TempCache] Failed to clean up temp databases:', error)
  }
}
