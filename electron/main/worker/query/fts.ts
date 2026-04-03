/**
 * FTS5 全文搜索索引管理模块
 *
 * 使用 Contentless FTS5 虚拟表为 message.content 提供倒排索引。
 * 通过应用层预分词（jieba + Intl.Segmenter），空格分隔后存入 FTS5。
 *
 * DELETE 策略：不在 FTS 做同步删除，依赖 JOIN message 自然过滤。
 * 提供 rebuildFtsIndex() 用于手动清理无效条目。
 */

import Database from 'better-sqlite3'
import { getDbPath, openDatabase } from '../core'
import { tokenizeForFts, tokenizeQueryForFts } from '../../nlp/ftsTokenizer'

const BATCH_SIZE = 5000

const CREATE_FTS_TABLE_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
    content,
    content='',
    content_rowid=id
  )
`

/**
 * 打开可写数据库（FTS 写入专用，不使用缓存池）
 */
function openWritableDb(sessionId: string): Database.Database | null {
  const dbPath = getDbPath(sessionId)
  try {
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    return db
  } catch {
    return null
  }
}

/**
 * 检查数据库是否已有 FTS 索引
 */
export function hasFtsIndex(sessionId: string): boolean {
  const db = openDatabase(sessionId)
  if (!db) return false
  try {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='message_fts'")
      .get() as { name: string } | undefined
    return !!row
  } catch {
    return false
  }
}

/**
 * 创建 FTS 虚拟表（如果不存在）
 */
export function createFtsTable(db: Database.Database): void {
  db.exec(CREATE_FTS_TABLE_SQL)
}

/**
 * 批量构建 FTS 索引（分批处理，每批 BATCH_SIZE 条）
 * 用于迁移或首次导入后的全量构建。
 */
export function buildFtsIndex(sessionId: string): { indexed: number } {
  const db = openWritableDb(sessionId)
  if (!db) return { indexed: 0 }

  try {
    createFtsTable(db)

    const insertFts = db.prepare('INSERT INTO message_fts(rowid, content) VALUES (?, ?)')

    const countRow = db.prepare(
      "SELECT COUNT(*) as total FROM message WHERE type = 0 AND content IS NOT NULL AND content != ''"
    ).get() as { total: number }
    const total = countRow.total

    let indexed = 0
    let offset = 0

    while (offset < total) {
      const rows = db
        .prepare(
          `SELECT id, content FROM message
           WHERE type = 0 AND content IS NOT NULL AND content != ''
           ORDER BY id ASC
           LIMIT ? OFFSET ?`
        )
        .all(BATCH_SIZE, offset) as Array<{ id: number; content: string }>

      if (rows.length === 0) break

      const batchInsert = db.transaction(() => {
        for (const row of rows) {
          const tokens = tokenizeForFts(row.content)
          if (tokens) {
            insertFts.run(row.id, tokens)
          }
        }
      })
      batchInsert()

      indexed += rows.length
      offset += BATCH_SIZE
    }

    return { indexed }
  } finally {
    db.close()
  }
}

/**
 * 重建 FTS 索引（清空后重新构建）
 * 用于清理无效条目（如删除成员后）或修复索引
 */
export function rebuildFtsIndex(sessionId: string): { indexed: number } {
  const db = openWritableDb(sessionId)
  if (!db) return { indexed: 0 }

  try {
    const hasTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='message_fts'")
      .get()

    if (hasTable) {
      db.exec('DROP TABLE message_fts')
    }

    db.close()

    return buildFtsIndex(sessionId)
  } catch {
    db.close()
    return { indexed: 0 }
  }
}

/**
 * 批量写入 FTS 条目
 * 用于增量导入时同步写入
 */
export function insertFtsEntries(
  sessionId: string,
  entries: Array<{ id: number; content: string | null }>
): void {
  const db = openWritableDb(sessionId)
  if (!db) return

  try {
    const hasTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='message_fts'")
      .get()
    if (!hasTable) {
      db.close()
      return
    }

    const insertFts = db.prepare('INSERT INTO message_fts(rowid, content) VALUES (?, ?)')

    const batchInsert = db.transaction(() => {
      for (const entry of entries) {
        if (entry.content) {
          const tokens = tokenizeForFts(entry.content)
          if (tokens) {
            insertFts.run(entry.id, tokens)
          }
        }
      }
    })
    batchInsert()
  } finally {
    db.close()
  }
}

/**
 * 通过 FTS5 搜索消息，返回匹配的 message rowids
 */
export function searchByFts(
  sessionId: string,
  keywords: string[],
  limit: number = 1000,
  offset: number = 0
): { rowids: number[]; total: number } {
  if (keywords.length === 0) return { rowids: [], total: 0 }

  const db = openDatabase(sessionId)
  if (!db) return { rowids: [], total: 0 }

  const matchQuery = tokenizeQueryForFts(keywords)
  if (!matchQuery) return { rowids: [], total: 0 }

  try {
    const countRow = db
      .prepare('SELECT COUNT(*) as total FROM message_fts WHERE content MATCH ?')
      .get(matchQuery) as { total: number }

    const rows = db
      .prepare(
        `SELECT rowid FROM message_fts WHERE content MATCH ? ORDER BY rank LIMIT ? OFFSET ?`
      )
      .all(matchQuery, limit, offset) as Array<{ rowid: number }>

    return {
      rowids: rows.map((r) => r.rowid),
      total: countRow.total,
    }
  } catch (error) {
    console.error('[FTS] Search failed, query:', matchQuery, error)
    return { rowids: [], total: 0 }
  }
}
