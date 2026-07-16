/**
 * Import module utilities shared across stream/incremental import.
 */

import type Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import { parentPort } from 'worker_threads'
import { getDbDir, openRawDatabase } from '../core'
import { CHAT_DB_TABLES, CHAT_DB_INDEXES } from '@openchatlab/core'
import type { ParseProgress } from '@openchatlab/parser'

export function sendProgress(requestId: string, progress: ParseProgress): void {
  parentPort?.postMessage({
    id: requestId,
    type: 'progress',
    payload: progress,
  })
}

export function generateSessionId(): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  return `chat_${timestamp}_${random}`
}

export function getDbPath(sessionId: string): string {
  return path.join(getDbDir(), `${sessionId}.db`)
}

/**
 * Create a database with tables only (no indexes) for fast bulk import.
 * Indexes should be created via createIndexes() after import completes.
 */
export function createDatabaseWithoutIndexes(sessionId: string): Database.Database {
  const dbDir = getDbDir()
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  const dbPath = getDbPath(sessionId)
  const db = openRawDatabase(dbPath)

  db.pragma('synchronous = NORMAL')
  db.pragma('cache_size = -64000') // 64MB cache for write performance

  db.exec(CHAT_DB_TABLES)

  return db
}

/**
 * Create indexes after bulk import completes.
 * Uses the canonical index definitions from @openchatlab/core.
 */
export function createIndexes(db: Database.Database): void {
  db.exec(CHAT_DB_INDEXES)
}
