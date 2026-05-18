/**
 * Server-side merge session cache.
 *
 * Manages temporary databases for the multi-file merge workflow.
 * Each uploaded/parsed file gets a temp DB handle that persists
 * across HTTP requests until merge completes or cache is cleared.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import type { PathProvider, DatabaseAdapter } from '@openchatlab/core'
import {
  openBetterSqliteDatabase,
  TempDbReader,
  deleteTempDatabase,
  cleanupTempDatabases,
} from '@openchatlab/node-runtime'

interface CacheEntry {
  tempDbPath: string
  filename: string
  createdAt: number
}

export class MergeSessionCache {
  private cache = new Map<string, CacheEntry>()
  private tempDir: string
  private nativeBinding?: string

  constructor(pathProvider: PathProvider, options?: { nativeBinding?: string }) {
    this.tempDir = pathProvider.getTempDir()
    this.nativeBinding = options?.nativeBinding
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true })
    }
  }

  generateTempDbPath(filename: string): string {
    const ts = Date.now()
    const rand = Math.random().toString(36).slice(2, 8)
    const safeName = filename.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 40)
    return path.join(this.tempDir, `merge_${safeName}_${ts}_${rand}.db`)
  }

  /** Store a parsed file's temp DB and return a handle for subsequent requests. */
  store(filename: string, tempDbPath: string): string {
    const handle = crypto.randomUUID()
    this.cache.set(handle, { tempDbPath, filename, createdAt: Date.now() })
    return handle
  }

  /** Open a TempDbReader for a given handle. Caller must close the reader. */
  openReader(handle: string): { reader: TempDbReader; filename: string } | null {
    const entry = this.cache.get(handle)
    if (!entry || !fs.existsSync(entry.tempDbPath)) return null
    const adapter = openBetterSqliteDatabase(entry.tempDbPath, {
      readonly: true,
      nativeBinding: this.nativeBinding,
    })
    return { reader: new TempDbReader(adapter), filename: entry.filename }
  }

  /** Create a writable temp DB for streaming parse. */
  createTempDatabase(filename: string): { db: DatabaseAdapter; tempDbPath: string } {
    const tempDbPath = this.generateTempDbPath(filename)
    const adapter = openBetterSqliteDatabase(tempDbPath, { nativeBinding: this.nativeBinding })
    return { db: adapter, tempDbPath }
  }

  /** Remove a single entry and its temp DB file. */
  delete(handle: string): void {
    const entry = this.cache.get(handle)
    if (entry) {
      deleteTempDatabase(entry.tempDbPath)
      this.cache.delete(handle)
    }
  }

  /** Clear all entries and delete their temp DB files. */
  clear(): void {
    for (const entry of this.cache.values()) {
      deleteTempDatabase(entry.tempDbPath)
    }
    this.cache.clear()
  }

  /** Cleanup orphan temp DBs from previous runs. */
  cleanupOrphans(): void {
    cleanupTempDatabases(this.tempDir)
  }

  /** Auto-cleanup entries older than maxAge (default 1 hour). */
  cleanupExpired(maxAgeMs = 3600_000): void {
    const now = Date.now()
    for (const [handle, entry] of this.cache) {
      if (now - entry.createdAt > maxAgeMs) {
        deleteTempDatabase(entry.tempDbPath)
        this.cache.delete(handle)
      }
    }
  }
}
