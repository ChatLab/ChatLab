/**
 * 数据库连接管理器
 *
 * 管理 ChatLab 会话数据库的打开、缓存与关闭。
 * 等效于 electron/main/worker/core/dbCore.ts 中的 dbCache 机制，
 * 但基于 DatabaseAdapter 接口而非直接使用 better-sqlite3。
 */

import * as fs from 'fs'
import * as path from 'path'
import type { DatabaseAdapter, PathProvider } from '@openchatlab/core'
import {
  isChatSessionDb,
  runMigrations,
  needsMigration as coreNeedsMigration,
  CURRENT_SCHEMA_VERSION,
} from '@openchatlab/core'
import { openBetterSqliteDatabase } from './better-sqlite3-adapter'
import { getChatDbMigrations, type MigrationDeps } from './migrations'

export class DatabaseManager {
  private cache = new Map<string, DatabaseAdapter>()
  private nativeBinding?: string
  private migrationDeps?: MigrationDeps

  constructor(
    private pathProvider: PathProvider,
    options?: { nativeBinding?: string; migrationDeps?: MigrationDeps }
  ) {
    this.nativeBinding = options?.nativeBinding
    this.migrationDeps = options?.migrationDeps
  }

  /**
   * Open a session DB (read-only by default, cached).
   */
  open(sessionId: string, options?: { readonly?: boolean }): DatabaseAdapter | null {
    if (this.cache.has(sessionId)) {
      return this.cache.get(sessionId)!
    }

    const dbPath = this.getDbPath(sessionId)
    if (!fs.existsSync(dbPath)) return null

    this.migrateIfNeeded(dbPath)

    const adapter = openBetterSqliteDatabase(dbPath, {
      readonly: options?.readonly ?? true,
      nativeBinding: this.nativeBinding,
    })
    this.cache.set(sessionId, adapter)
    return adapter
  }

  private migrateIfNeeded(dbPath: string): void {
    const adapter = openBetterSqliteDatabase(dbPath, {
      readonly: false,
      nativeBinding: this.nativeBinding,
    })

    try {
      if (coreNeedsMigration(adapter, CURRENT_SCHEMA_VERSION)) {
        const migrations = getChatDbMigrations(this.migrationDeps)
        runMigrations(adapter, migrations)
      }
    } finally {
      adapter.close()
    }
  }

  /**
   * Open a session DB in read-write mode and auto-run pending migrations.
   * Falls back to `open(id, { readonly: false })` if migration is unnecessary.
   */
  openWritable(sessionId: string): DatabaseAdapter | null {
    const existing = this.cache.get(sessionId)
    if (existing && !existing.readonly) return existing

    if (existing) {
      existing.close()
      this.cache.delete(sessionId)
    }

    const dbPath = this.getDbPath(sessionId)
    if (!fs.existsSync(dbPath)) return null

    const adapter = openBetterSqliteDatabase(dbPath, {
      readonly: false,
      nativeBinding: this.nativeBinding,
    })

    if (coreNeedsMigration(adapter, CURRENT_SCHEMA_VERSION)) {
      const migrations = getChatDbMigrations(this.migrationDeps)
      runMigrations(adapter, migrations)
    }

    this.cache.set(sessionId, adapter)
    return adapter
  }

  /**
   * 关闭指定会话的数据库连接
   */
  close(sessionId: string): void {
    const adapter = this.cache.get(sessionId)
    if (adapter) {
      adapter.close()
      this.cache.delete(sessionId)
    }
  }

  /**
   * 关闭所有数据库连接
   */
  closeAll(): void {
    for (const [id, adapter] of this.cache) {
      adapter.close()
      this.cache.delete(id)
    }
  }

  /**
   * 列举数据库目录下的所有聊天会话 ID
   */
  listSessionIds(): string[] {
    const dbDir = this.pathProvider.getDatabaseDir()
    if (!fs.existsSync(dbDir)) return []

    return fs
      .readdirSync(dbDir)
      .filter((f) => f.endsWith('.db'))
      .map((f) => f.replace('.db', ''))
      .filter((id) => {
        const db = this.open(id)
        if (!db) return false
        return isChatSessionDb(db)
      })
  }

  /**
   * 获取数据库文件路径
   */
  getDbPath(sessionId: string): string {
    return path.join(this.pathProvider.getDatabaseDir(), `${sessionId}.db`)
  }
}
