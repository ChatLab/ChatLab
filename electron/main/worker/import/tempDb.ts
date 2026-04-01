/**
 * 临时数据库模块
 * 用于合并导入时的临时文件处理
 */

import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

// 在 Worker 线程中，无法直接使用 electron 的 app 模块
// 需要通过其他方式获取临时目录
function getTempDir(): string {
  // 在 worker 中，使用系统临时目录
  const tmpDir = process.env.TMPDIR || process.env.TMP || '/tmp'
  const chatLabTmp = path.join(tmpDir, 'chatlab-temp')
  if (!fs.existsSync(chatLabTmp)) {
    fs.mkdirSync(chatLabTmp, { recursive: true })
  }
  return chatLabTmp
}

/**
 * 创建临时数据库用于合并
 */
export function createTempDatabase(): { db: Database.Database; path: string } {
  const tempDir = getTempDir()
  const tempPath = path.join(tempDir, `merge_${Date.now()}_${Math.random().toString(36).slice(2)}.db`)
  const db = new Database(tempPath)

  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('cache_size = -64000')

  // 创建临时表结构
  db.exec(`
    CREATE TABLE IF NOT EXISTS member (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL UNIQUE,
      account_name TEXT,
      group_nickname TEXT,
      aliases TEXT DEFAULT '[]',
      avatar TEXT,
      roles TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_platform_id TEXT NOT NULL,
      sender_account_name TEXT,
      sender_group_nickname TEXT,
      ts INTEGER NOT NULL,
      type INTEGER NOT NULL,
      content TEXT,
      reply_to_message_id TEXT DEFAULT NULL,
      platform_message_id TEXT DEFAULT NULL
    );
  `)

  return { db, path: tempPath }
}

/**
 * 关闭并清理临时数据库
 */
export function cleanupTempDatabase(dbPath: string): void {
  try {
    // 尝试删除 WAL 和 SHM 文件
    const walPath = `${dbPath}-wal`
    const shmPath = `${dbPath}-shm`

    if (fs.existsSync(walPath)) {
      fs.unlinkSync(walPath)
    }
    if (fs.existsSync(shmPath)) {
      fs.unlinkSync(shmPath)
    }
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath)
    }
  } catch (err) {
    console.error('Failed to clean up temp databases:', err)
  }
}

/**
 * 生成消息去重键
 * 使用固定长度哈希作为去重标识。
 * 直接用 content.length 会误判等长不同内容，直接用原文又会让 Set 长期持有大文本。
 */
export function generateMessageKey(timestamp: number, senderPlatformId: string, content: string | null): string {
  // 去重 key 需要和当前写库语义一致，空字符串在存储层会被折叠成 null。
  const normalizedContent = content || null
  const hash = createHash('sha256')
  hash.update(String(timestamp))
  hash.update('\0')
  hash.update(senderPlatformId)
  hash.update('\0')
  hash.update(normalizedContent === null ? 'null' : 'text')
  hash.update('\0')
  if (normalizedContent !== null) {
    hash.update(normalizedContent)
  }
  return hash.digest('base64url')
}
