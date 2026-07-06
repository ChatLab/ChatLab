/**
 * FTS5 full-text search index management — Electron adapter layer.
 *
 * Core FTS operations are delegated to @openchatlab/node-runtime.
 * This module adds session-level DB connection management.
 */

import type Database from 'better-sqlite3'
import { BetterSqliteAdapter } from '@openchatlab/node-runtime'
import {
  hasFtsTable,
  createFtsTable as coreCreateFtsTable,
  buildFtsIndex as coreBuildFtsIndex,
  rebuildFtsIndex as coreRebuildFtsIndex,
  insertFtsEntries as coreInsertFtsEntries,
  searchByFts as coreSearchByFts,
} from '@openchatlab/node-runtime'
import { getDbPath, openRawDatabase, openDatabase } from '../core'

function openWritableDb(sessionId: string): Database.Database | null {
  try {
    return openRawDatabase(getDbPath(sessionId))
  } catch {
    return null
  }
}

export function hasFtsIndex(sessionId: string): boolean {
  const db = openDatabase(sessionId)
  if (!db) return false
  try {
    return hasFtsTable(new BetterSqliteAdapter(db))
  } catch {
    return false
  }
}

export function createFtsTable(db: Database.Database): void {
  coreCreateFtsTable(new BetterSqliteAdapter(db))
}

export function buildFtsIndex(sessionId: string): { indexed: number } {
  const db = openWritableDb(sessionId)
  if (!db) return { indexed: 0 }

  try {
    return coreBuildFtsIndex(new BetterSqliteAdapter(db))
  } finally {
    db.close()
  }
}

export function rebuildFtsIndex(sessionId: string): { indexed: number } {
  const db = openWritableDb(sessionId)
  if (!db) return { indexed: 0 }

  try {
    return coreRebuildFtsIndex(new BetterSqliteAdapter(db))
  } finally {
    db.close()
  }
}

export function insertFtsEntries(sessionId: string, entries: Array<{ id: number; content: string | null }>): void {
  const db = openWritableDb(sessionId)
  if (!db) return

  try {
    coreInsertFtsEntries(new BetterSqliteAdapter(db), entries)
  } finally {
    db.close()
  }
}

export function searchByFts(
  sessionId: string,
  keywords: string[],
  limit = 1000,
  offset = 0
): { rowids: number[]; total: number } {
  if (keywords.length === 0) return { rowids: [], total: 0 }

  const db = openDatabase(sessionId)
  if (!db) return { rowids: [], total: 0 }

  return coreSearchByFts(new BetterSqliteAdapter(db), keywords, limit, offset)
}
