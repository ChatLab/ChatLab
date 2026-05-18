/**
 * Temp DB cache — Electron adapter layer.
 *
 * Keeps Electron-specific path helpers (getTempDir, generateTempDbPath).
 * TempDbReader wraps the shared implementation with better-sqlite3 opening.
 * TempDbWriter/cleanup delegate to shared @openchatlab/node-runtime.
 */

import Database from 'better-sqlite3'
import * as path from 'path'
import { BetterSqliteAdapter, TEMP_DB_SCHEMA } from '@openchatlab/node-runtime'
import {
  TempDbReader as SharedTempDbReader,
  deleteTempDatabase as sharedDeleteTempDb,
  cleanupTempDatabases as sharedCleanupTempDbs,
} from '@openchatlab/node-runtime'
import { getPathProvider } from '../path-context'
import { ensureDir } from '../paths'

function getTempDir(): string {
  const dir = getPathProvider().getTempDir()
  ensureDir(dir)
  return dir
}

export function generateTempDbPath(sourceFilePath: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  const baseName = path.basename(sourceFilePath, path.extname(sourceFilePath))
  const safeName = baseName.replace(/[/\\?%*:|"<>]/g, '_').substring(0, 50)
  return path.join(getTempDir(), `merge_${safeName}_${timestamp}_${random}.db`)
}

/**
 * Create a temp database and return the raw better-sqlite3 handle.
 * Used by streamImport.ts which wraps it in BetterSqliteAdapter.
 */
export function createTempDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.exec(TEMP_DB_SCHEMA)
  return db
}

/**
 * Electron TempDbReader — opens the temp DB with better-sqlite3
 * and delegates to the shared TempDbReader via BetterSqliteAdapter.
 */
export class TempDbReader {
  private inner: SharedTempDbReader
  private dbPath: string

  constructor(dbPath: string) {
    this.dbPath = dbPath
    const db = new Database(dbPath, { readonly: true })
    db.pragma('journal_mode = WAL')
    this.inner = new SharedTempDbReader(new BetterSqliteAdapter(db))
  }

  getMeta() {
    return this.inner.getMeta()
  }

  getMembers() {
    return this.inner.getMembers()
  }

  getMessageCount() {
    return this.inner.getMessageCount()
  }

  streamMessages(batchSize: number, callback: Parameters<SharedTempDbReader['streamMessages']>[1]) {
    return this.inner.streamMessages(batchSize, callback)
  }

  getAllMessages() {
    return this.inner.getAllMessages()
  }

  close() {
    this.inner.close()
  }

  getPath() {
    return this.dbPath
  }

  toDataSource() {
    return this.inner.toDataSource()
  }
}

export function deleteTempDatabase(dbPath: string): void {
  sharedDeleteTempDb(dbPath)
}

export function cleanupAllTempDatabases(): void {
  try {
    sharedCleanupTempDbs(getTempDir())
  } catch (error) {
    console.error('[TempCache] Failed to clean up temp databases:', error)
  }
}
