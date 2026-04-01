/**
 * 导入模块工具函数
 * 提供通用的工具函数供各导入模块共享
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import { parentPort } from 'worker_threads'
import { getDbDir } from '../core'
import type { ParseProgress } from '../../parser'

/**
 * 发送进度到主进程
 */
export function sendProgress(requestId: string, progress: ParseProgress): void {
  parentPort?.postMessage({
    id: requestId,
    type: 'progress',
    payload: progress,
  })
}

/**
 * 生成唯一的会话ID
 */
export function generateSessionId(): string {
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
 * 创建数据库并初始化表结构（不含索引，用于快速导入）
 */
export function createDatabaseWithoutIndexes(sessionId: string): Database.Database {
  const dbDir = getDbDir()
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  const dbPath = getDbPath(sessionId)
  const db = new Database(dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  // 增加缓存大小以提高写入性能
  db.pragma('cache_size = -64000') // 64MB 缓存

  // 创建表结构（不创建索引，导入完成后再创建）
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      group_id TEXT,
      group_avatar TEXT,
      owner_id TEXT,
      schema_version INTEGER DEFAULT 3,
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
  `)

  return db
}

/**
 * 导入完成后创建索引
 */
export function createIndexes(db: Database.Database): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_message_ts ON message(ts);
    CREATE INDEX IF NOT EXISTS idx_message_sender ON message(sender_id);
    CREATE INDEX IF NOT EXISTS idx_message_platform_id ON message(platform_message_id);
    CREATE INDEX IF NOT EXISTS idx_member_name_history_member_id ON member_name_history(member_id);
    CREATE INDEX IF NOT EXISTS idx_session_time ON chat_session(start_ts, end_ts);
    CREATE INDEX IF NOT EXISTS idx_context_session ON message_context(session_id);
  `)
}
