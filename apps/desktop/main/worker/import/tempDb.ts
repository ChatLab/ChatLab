/**
 * 临时数据库模块
 * 用于合并导入时的临时文件处理
 */

import type Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import { getChatLabTempScopeDir } from '@openchatlab/node-runtime/temp-workspace'
// 直接从 dbCore 导入：core/index 会连带 perfLogger → @openchatlab/node-runtime，
// 而本模块被纯 Node 单测导入，需保持依赖面最小。
import { openRawDatabase } from '../core/dbCore'

function getTempDir(): string {
  return getChatLabTempScopeDir('merge')
}

/**
 * 创建临时数据库用于合并
 */
export function createTempDatabase(): { db: Database.Database; path: string } {
  const tempDir = getTempDir()
  const tempPath = path.join(tempDir, `merge_${Date.now()}_${Math.random().toString(36).slice(2)}.db`)
  const db = openRawDatabase(tempPath)

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

// Re-export the canonical dedup key generator from core
export { generateMessageKey } from '@openchatlab/core'
