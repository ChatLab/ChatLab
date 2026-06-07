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
  CHAT_DB_TABLES,
  isChatSessionDb,
  runMigrations as coreRunMigrations,
  needsMigration as coreNeedsMigration,
  CURRENT_SCHEMA_VERSION,
  getSchemaVersion,
} from '@openchatlab/core'
import { openBetterSqliteDatabase } from './better-sqlite3-adapter'
import { assertDataDirCompatible, type RuntimeIdentity } from './data-dir-compat'
import {
  CHAT_DB_COMPATIBILITY_RAISES,
  getChatDbMigrations,
  raiseChatDbCompatibilityGate,
  type MigrationDeps,
} from './migrations'
import { tokenizeForFts } from './nlp/fts-tokenizer'

function createMigrationDeps(overrides?: MigrationDeps): MigrationDeps {
  return {
    tokenizeForFts,
    ...overrides,
  }
}

interface DatabaseManagerOptions {
  nativeBinding?: string
  migrationDeps?: MigrationDeps
  runtime?: RuntimeIdentity
  allowMissingRuntimeForTests?: boolean
}

interface OpenRawSessionDatabaseOptions {
  readonly?: boolean
  create?: boolean
  initializeChatTables?: boolean
}

export class DatabaseManager {
  private cache = new Map<string, DatabaseAdapter>()
  private nativeBinding?: string
  private migrationDeps?: MigrationDeps
  private runtime: RuntimeIdentity | null

  constructor(
    private pathProvider: PathProvider,
    options: DatabaseManagerOptions = {}
  ) {
    if (!options.runtime && !options.allowMissingRuntimeForTests) {
      throw new Error('DatabaseManager runtime identity is required for data directory compatibility checks.')
    }

    this.nativeBinding = options?.nativeBinding
    this.migrationDeps = createMigrationDeps(options?.migrationDeps)
    this.runtime = options?.runtime ?? null
  }

  /**
   * Open a session DB (read-only by default, cached).
   */
  open(sessionId: string, options?: { readonly?: boolean }): DatabaseAdapter | null {
    this.assertCompatible()

    if (this.cache.has(sessionId)) {
      return this.cache.get(sessionId)!
    }

    const dbPath = this.getDbPath(sessionId)
    if (!fs.existsSync(dbPath)) return null

    this.migrateIfNeeded(dbPath)
    this.assertCompatible()

    const adapter = openBetterSqliteDatabase(dbPath, {
      readonly: options?.readonly ?? true,
      nativeBinding: this.nativeBinding,
    })
    this.cache.set(sessionId, adapter)
    return adapter
  }

  private migrateIfNeeded(dbPath: string): void {
    const readonlyAdapter = openBetterSqliteDatabase(dbPath, {
      readonly: true,
      nativeBinding: this.nativeBinding,
    })

    try {
      if (!isChatSessionDb(readonlyAdapter)) return
      this.raiseCompatibilityGateIfNeeded(getSchemaVersion(readonlyAdapter))
      if (!coreNeedsMigration(readonlyAdapter, CURRENT_SCHEMA_VERSION)) return
    } finally {
      readonlyAdapter.close()
    }

    const adapter = openBetterSqliteDatabase(dbPath, {
      readonly: false,
      nativeBinding: this.nativeBinding,
    })

    try {
      const migrations = getChatDbMigrations(this.migrationDeps)
      this.runMigrations(adapter, migrations)
    } finally {
      adapter.close()
    }
  }

  /**
   * Open a session DB in read-write mode and auto-run pending migrations.
   * Falls back to `open(id, { readonly: false })` if migration is unnecessary.
   */
  openWritable(sessionId: string): DatabaseAdapter | null {
    this.assertCompatible()

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
      this.runMigrations(adapter, migrations)
      this.assertCompatible()
    } else {
      this.raiseCompatibilityGateIfNeeded(getSchemaVersion(adapter))
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
    this.assertCompatible()

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

  openRawSessionDatabase(sessionId: string, options: OpenRawSessionDatabaseOptions = {}): DatabaseAdapter {
    this.assertCompatible()

    const dbPath = this.getDbPath(sessionId)
    if (!options.create && !fs.existsSync(dbPath)) {
      throw new Error(`Session database not found: ${sessionId}`)
    }

    if (!options.readonly) {
      this.close(sessionId)
      fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    }

    const adapter = openBetterSqliteDatabase(dbPath, {
      readonly: options.readonly ?? false,
      nativeBinding: this.nativeBinding,
    })

    if (options.initializeChatTables) {
      adapter.exec(CHAT_DB_TABLES)
    }

    return adapter
  }

  deleteSessionDatabaseFiles(sessionId: string): void {
    this.close(sessionId)

    const dbPath = this.getDbPath(sessionId)
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        const filePath = dbPath + suffix
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      } catch {
        /* ignore cleanup failures */
      }
    }
  }

  raiseCurrentChatDbCompatibilityGate(): void {
    if (!this.runtime) return
    raiseChatDbCompatibilityGate(this.pathProvider, this.runtime)
  }

  private assertCompatible(): void {
    if (!this.runtime) return
    assertDataDirCompatible(this.pathProvider, this.runtime)
  }

  private runMigrations(adapter: DatabaseAdapter, migrations: ReturnType<typeof getChatDbMigrations>): void {
    const beforeVersion = getSchemaVersion(adapter)
    const migrated = coreRunMigrations(adapter, migrations)
    if (!migrated || !this.runtime) return

    const afterVersion = getSchemaVersion(adapter)
    if (shouldRaiseCompatibilityGate(beforeVersion, afterVersion)) {
      this.raiseCurrentChatDbCompatibilityGate()
    }
  }

  private raiseCompatibilityGateIfNeeded(schemaVersion: number): void {
    if (!this.runtime) return
    if (shouldRepairCompatibilityGate(schemaVersion)) {
      this.raiseCurrentChatDbCompatibilityGate()
    }
  }
}

function shouldRaiseCompatibilityGate(beforeVersion: number, afterVersion: number): boolean {
  return CHAT_DB_COMPATIBILITY_RAISES.some(
    (compatibilityRaise) =>
      beforeVersion < compatibilityRaise.migrationVersion && afterVersion >= compatibilityRaise.migrationVersion
  )
}

function shouldRepairCompatibilityGate(schemaVersion: number): boolean {
  return CHAT_DB_COMPATIBILITY_RAISES.some((compatibilityRaise) => schemaVersion >= compatibilityRaise.migrationVersion)
}
