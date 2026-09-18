/**
 * Message full-text search index (FTS5 trigram).
 *
 * The index itself is declared in ../schema/tables.ts and created together with
 * the other message indexes. This module owns everything the query path needs
 * around it: creating and backfilling it, deciding whether a keyword set can use
 * it, and turning keywords into an FTS5 MATCH expression.
 *
 * Trigram tokenization only indexes sequences of three or more code points, so
 * shorter keywords (notably two-character Chinese words) must keep using LIKE.
 */

import type { DatabaseAdapter } from '../interfaces'
import type { AsyncSqlExecutor } from './message-query-functions'
import { MESSAGE_FTS_DDL, MESSAGE_FTS_TABLE } from '../schema/tables'
import { hasTable } from './filters'

/** Shortest keyword the trigram tokenizer can match. */
const MIN_FTS_KEYWORD_LENGTH = 3

/**
 * FTS5 stores one row per indexed document here. An external-content table
 * answers `COUNT(*)` from the content table instead of the index, so this shadow
 * table is the only way to tell an empty index from a populated one. It exists
 * for every FTS5 table that does not set `columnsize=0`.
 */
const MESSAGE_FTS_DOCSIZE_TABLE = `${MESSAGE_FTS_TABLE}_docsize`

export interface MessageSearchIndexResult {
  /** Whether the index content was (re)built, as opposed to already being in sync. */
  rebuilt: boolean
  /** Row count of the index after the call. */
  rows: number
  durationMs: number
}

/**
 * Databases known to have the index, so the search path does not hit
 * sqlite_master on every query. Only ever set to true: an adapter that lost the
 * table would have to be reopened, which produces a new adapter object.
 */
const indexPresence = new WeakMap<DatabaseAdapter, boolean>()

/** Whether this database has the FTS index available for keyword search. */
export function hasMessageSearchIndex(db: DatabaseAdapter): boolean {
  const cached = indexPresence.get(db)
  if (cached !== undefined) return cached

  const present = hasTable(db, MESSAGE_FTS_TABLE)
  if (present) indexPresence.set(db, true)
  return present
}

/** Async variant for executor-based runtimes; not cached (executors are per-request). */
export async function hasMessageSearchIndexAsync(executor: AsyncSqlExecutor): Promise<boolean> {
  const row = await executor.get<Record<string, unknown>>(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
    [MESSAGE_FTS_TABLE]
  )
  return row !== undefined
}

/**
 * Create the FTS index if missing and backfill it when it does not cover every
 * message. Idempotent: on an already-synced database it costs two COUNT(*).
 *
 * Runs in a transaction so a failed rebuild leaves no half-populated index.
 * Callers own the logging — core has no logger.
 */
export function ensureMessageSearchIndex(db: DatabaseAdapter): MessageSearchIndexResult {
  const startedAt = Date.now()

  const result = db.transaction(() => {
    db.exec(MESSAGE_FTS_DDL)

    const messageCount = (db.prepare('SELECT COUNT(*) as total FROM message').get() as { total: number }).total
    const indexedCount = (
      db.prepare(`SELECT COUNT(*) as total FROM ${MESSAGE_FTS_DOCSIZE_TABLE}`).get() as { total: number }
    ).total
    if (messageCount === indexedCount) return { rebuilt: false, rows: indexedCount }

    db.prepare(`INSERT INTO ${MESSAGE_FTS_TABLE}(${MESSAGE_FTS_TABLE}) VALUES('rebuild')`).run()
    return { rebuilt: true, rows: messageCount }
  })

  indexPresence.set(db, true)
  return { ...result, durationMs: Date.now() - startedAt }
}

/**
 * Whether the trigram index can answer this keyword set. Any keyword shorter
 * than three code points would silently match nothing, so such searches stay on
 * LIKE.
 */
export function canUseFtsKeywords(keywords: string[]): boolean {
  if (keywords.length === 0) return false
  return keywords.every((keyword) => [...keyword.trim()].length >= MIN_FTS_KEYWORD_LENGTH)
}

/**
 * Build an FTS5 MATCH expression. Each keyword becomes a quoted string so its
 * punctuation and spaces are matched literally rather than parsed as query
 * syntax; embedded double quotes are doubled per FTS5 string literal rules.
 */
export function buildFtsMatchExpression(keywords: string[], matchMode: 'any' | 'all'): string {
  const joiner = matchMode === 'all' ? ' AND ' : ' OR '
  return keywords.map((keyword) => `"${keyword.replace(/"/g, '""')}"`).join(joiner)
}
