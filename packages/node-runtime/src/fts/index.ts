/**
 * FTS5 full-text search index operations (platform-agnostic).
 *
 * Extracted from electron/main/worker/query/fts.ts.
 * Works with DatabaseAdapter + NLP tokenizer from this package.
 */

import type { DatabaseAdapter } from '@openchatlab/core'
import { FTS_TABLE_SCHEMA } from '@openchatlab/core'
import { tokenizeForFts, tokenizeQueryForFts } from '../nlp'

const BATCH_SIZE = 5000

/**
 * Check if FTS virtual table exists in the database.
 */
export function hasFtsTable(db: DatabaseAdapter): boolean {
  try {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='message_fts'").get()
    return !!row
  } catch {
    return false
  }
}

/**
 * Create FTS virtual table if it doesn't exist.
 */
export function createFtsTable(db: DatabaseAdapter): void {
  db.exec(FTS_TABLE_SCHEMA)
}

/**
 * Build FTS index from all text messages in the database.
 * Processes in batches for memory efficiency.
 */
export function buildFtsIndex(db: DatabaseAdapter): { indexed: number } {
  createFtsTable(db)

  const insertFts = db.prepare('INSERT INTO message_fts(rowid, content) VALUES (?, ?)')

  let indexed = 0
  let lastId: number | null = null
  const selectFirstBatch = db.prepare(
    `SELECT id, content FROM message
     WHERE type = 0
       AND content IS NOT NULL
       AND content != ''
     ORDER BY id ASC
     LIMIT ?`
  )
  const selectNextBatch = db.prepare(
    `SELECT id, content FROM message
     WHERE type = 0
       AND content IS NOT NULL
       AND content != ''
       AND id > ?
     ORDER BY id ASC
     LIMIT ?`
  )

  while (true) {
    const rows = (
      lastId === null ? selectFirstBatch.all(BATCH_SIZE) : selectNextBatch.all(lastId, BATCH_SIZE)
    ) as Array<{ id: number; content: string }>
    if (rows.length === 0) break

    db.transaction(() => {
      for (const row of rows) {
        const tokens = tokenizeForFts(row.content)
        if (tokens) {
          insertFts.run(row.id, tokens)
        }
      }
    })

    indexed += rows.length
    lastId = rows[rows.length - 1].id
  }

  return { indexed }
}

/**
 * Rebuild FTS index by dropping and recreating.
 */
export function rebuildFtsIndex(db: DatabaseAdapter): { indexed: number } {
  if (hasFtsTable(db)) {
    db.exec('DROP TABLE message_fts')
  }
  return buildFtsIndex(db)
}

/**
 * Insert FTS entries for a batch of messages.
 * Used during incremental import to sync new messages.
 */
export function insertFtsEntries(db: DatabaseAdapter, entries: Array<{ id: number; content: string | null }>): void {
  if (!hasFtsTable(db)) return

  const insertFts = db.prepare('INSERT INTO message_fts(rowid, content) VALUES (?, ?)')

  db.transaction(() => {
    for (const entry of entries) {
      if (entry.content) {
        const tokens = tokenizeForFts(entry.content)
        if (tokens) {
          insertFts.run(entry.id, tokens)
        }
      }
    }
  })
}

/**
 * Search messages using FTS5, returning matching rowids.
 */
export function searchByFts(
  db: DatabaseAdapter,
  keywords: string[],
  limit = 1000,
  offset = 0
): { rowids: number[]; total: number } {
  if (keywords.length === 0) return { rowids: [], total: 0 }

  const matchQuery = tokenizeQueryForFts(keywords)
  if (!matchQuery) return { rowids: [], total: 0 }

  try {
    const countRow = db.prepare('SELECT COUNT(*) as total FROM message_fts WHERE content MATCH ?').get(matchQuery) as
      | { total: number }
      | undefined
    const total = countRow?.total ?? 0

    const rows = db
      .prepare(`SELECT rowid FROM message_fts WHERE content MATCH ? ORDER BY rank LIMIT ? OFFSET ?`)
      .all(matchQuery, limit, offset) as Array<{ rowid: number }>

    return {
      rowids: rows.map((r) => r.rowid),
      total,
    }
  } catch (error) {
    console.error('[FTS] Search failed, query:', matchQuery, error)
    return { rowids: [], total: 0 }
  }
}
