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
import { deleteSessionCache } from './cache/session-cache'
import {
  assertDataDirCompatible,
  DataDirCompatibilityError,
  isRuntimeVersionAtLeast,
  readDataDirCompatibilityMeta,
  type RuntimeIdentity,
} from './data-dir-compat'
import { CHAT_DB_COMPATIBILITY_RAISES, getChatDbMigrations, raiseChatDbCompatibilityGate } from './migrations'
import { getContactsFactsCacheDir } from './services/contacts/paths'
import {
  getGlobalInsightDir,
  getGlobalInsightFactsCacheDir,
  getTimeInvestmentDir,
  getTimeInvestmentFactsCacheDir,
} from './services/global-insight/paths'
import { deleteAnnualSummarySnapshots } from './services/global-insight/snapshot'
import { deleteTimeInvestmentSnapshots } from './services/global-insight/time-investment-snapshot'
import { getPeopleRelationshipsFactsCacheDir } from './services/people/relationships/paths'
import { assertSessionChatTopicsIdle, deleteSessionChatTopics } from './services/topics'

interface DatabaseManagerOptions {
  nativeBinding?: string
  runtime?: RuntimeIdentity
  allowMissingRuntimeForTests?: boolean
}

interface OpenRawSessionDatabaseOptions {
  readonly?: boolean
  create?: boolean
  initializeChatTables?: boolean
}

/**
 * List database candidates that require further inspection.
 * macOS AppleDouble `._*` files contain metadata rather than SQLite data.
 */
export function listDatabaseCandidateIds(databaseDir: string): string[] {
  if (!fs.existsSync(databaseDir)) return []

  return fs
    .readdirSync(databaseDir)
    .filter((fileName) => fileName.endsWith('.db') && !fileName.startsWith('._'))
    .map((fileName) => fileName.slice(0, -3))
}

export class DatabaseManager {
  private cache = new Map<string, DatabaseAdapter>()
  private nativeBinding?: string
  private runtime: RuntimeIdentity | null

  constructor(
    private pathProvider: PathProvider,
    options: DatabaseManagerOptions = {}
  ) {
    if (!options.runtime && !options.allowMissingRuntimeForTests) {
      throw new Error('DatabaseManager runtime identity is required for data directory compatibility checks.')
    }

    this.nativeBinding = options?.nativeBinding
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
      const migrations = getChatDbMigrations()
      this.runMigrations(adapter, migrations)
    } finally {
      adapter.close()
    }
  }

  /**
   * Open an uncached session database strictly for reading, without migrations.
   * This shared API is also used by CLI import analysis: do not require the
   * current schema here. The caller owns and must close the connection.
   */
  openReadonly(sessionId: string): DatabaseAdapter | null {
    this.assertCompatible()
    if (!fs.existsSync(this.getDbPath(sessionId))) return null
    return this.openRawSessionDatabase(sessionId, { readonly: true })
  }

  /**
   * MCP-only strict read access. Never migrate or repair data. Older schema
   * versions require an explicit upgrade through a writable ChatLab runtime.
   */
  openMcpReadonly(sessionId: string): DatabaseAdapter | null {
    const db = this.openReadonly(sessionId)
    if (!db) return null

    try {
      if (isChatSessionDb(db)) {
        const schemaVersion = getSchemaVersion(db)
        // SQLite INTEGER-affinity columns may actually contain TEXT, REAL or
        // BLOB values. A type assertion cannot protect numeric comparisons
        // from coercing invalid values (e.g. nonnumeric text to NaN).
        if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 0) {
          throw new Error(
            `ChatLab session ${sessionId} has an invalid schema version. ` +
              'Cannot safely serve this database through read-only MCP tools.'
          )
        }
        // The runtime cannot understand a future schema or safely repair its
        // compatibility metadata; report the version mismatch before the gate.
        if (schemaVersion > CURRENT_SCHEMA_VERSION) {
          throw new Error(
            `ChatLab session ${sessionId} uses schema v${schemaVersion}, but read-only MCP tools require ` +
              `schema v${CURRENT_SCHEMA_VERSION}. Upgrade the ChatLab runtime to one that supports this newer schema.`
          )
        }

        this.assertReadonlyCompatibilityGate(schemaVersion)
        if (schemaVersion < CURRENT_SCHEMA_VERSION) {
          throw new Error(
            `ChatLab session ${sessionId} uses schema v${schemaVersion}, but read-only MCP tools require ` +
              `schema v${CURRENT_SCHEMA_VERSION}. Open the session with the current writable ChatLab runtime to migrate it first.`
          )
        }
      }
      return db
    } catch (error) {
      db.close()
      throw error
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
      const migrations = getChatDbMigrations()
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
    return this.listSessionCandidateIds().filter((id) => {
      const db = this.open(id)
      if (!db) return false
      return isChatSessionDb(db)
    })
  }

  /**
   * 仅列出数据库文件候选，不同步打开所有数据库。
   * 需要逐库检查、取消和时间预算的调用方应使用此入口后自行验证。
   */
  listSessionCandidateIds(): string[] {
    this.assertCompatible()
    return listDatabaseCandidateIds(this.pathProvider.getDatabaseDir())
  }

  /**
   * 只读列举聊天会话 ID，不触发数据库迁移或兼容门禁提升。
   * CLI 导入预分析需要枚举未升级的旧库，因此不可强制当前 Schema。
   */
  listSessionIdsReadonly(): string[] {
    this.assertCompatible()

    const dbDir = this.pathProvider.getDatabaseDir()
    return listDatabaseCandidateIds(dbDir).filter((sessionId) => {
      const db = this.openReadonly(sessionId)
      if (!db) return false
      try {
        return isChatSessionDb(db)
      } finally {
        db.close()
      }
    })
  }

  /** MCP session discovery performs the same strict schema preflight as MCP queries. */
  listSessionIdsMcpReadonly(): string[] {
    this.assertCompatible()

    return listDatabaseCandidateIds(this.pathProvider.getDatabaseDir()).filter((sessionId) => {
      const db = this.openMcpReadonly(sessionId)
      if (!db) return false
      try {
        return isChatSessionDb(db)
      } finally {
        db.close()
      }
    })
  }

  getUserDataDir(): string {
    return this.pathProvider.getUserDataDir()
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

  /**
   * 删除一个会话在本地留下的完整文件集合。
   * SQLite WAL 模式会产生 sidecar 文件，前端查询还会写 JSON 缓存；只删主库会让列表和后续同步读到脏状态。
   */
  deleteSessionDatabaseFiles(sessionId: string): boolean {
    assertSessionChatTopicsIdle(this.pathProvider.getUserDataDir(), sessionId, { nativeBinding: this.nativeBinding })
    this.close(sessionId)

    const dbPath = this.getDbPath(sessionId)
    const existed = ['', '-wal', '-shm'].some((suffix) => fs.existsSync(dbPath + suffix))
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)

    for (const suffix of ['-wal', '-shm']) {
      try {
        const filePath = dbPath + suffix
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      } catch {
        /* ignore cleanup failures */
      }
    }

    // Derived data is removed only after the primary database is gone. If deleting the main file fails, callers get
    // the original filesystem error and can retry without losing paid topic snapshots or other cached results.
    deleteSessionChatTopics(this.pathProvider.getUserDataDir(), sessionId, { nativeBinding: this.nativeBinding })
    const cacheDir = this.pathProvider.getCacheDir()
    deleteSessionCache(sessionId, cacheDir)
    deleteSessionCache(sessionId, path.join(cacheDir, 'query'))
    deleteSessionCache(sessionId, getContactsFactsCacheDir(this.pathProvider.getUserDataDir()))
    deleteSessionCache(sessionId, getGlobalInsightFactsCacheDir(this.pathProvider.getUserDataDir()))
    deleteAnnualSummarySnapshots(getGlobalInsightDir(this.pathProvider.getUserDataDir()))
    deleteSessionCache(sessionId, getTimeInvestmentFactsCacheDir(this.pathProvider.getUserDataDir()))
    deleteTimeInvestmentSnapshots(getTimeInvestmentDir(this.pathProvider.getUserDataDir()))
    deleteSessionCache(sessionId, getPeopleRelationshipsFactsCacheDir(this.pathProvider.getUserDataDir()))
    return existed
  }

  raiseCurrentChatDbCompatibilityGate(): void {
    if (!this.runtime) return
    raiseChatDbCompatibilityGate(this.pathProvider, this.runtime)
  }

  /**
   * A read-only MCP request cannot repair missing compatibility metadata. Reject
   * affected schemas until a writable runtime has safely restored the gate.
   */
  private assertReadonlyCompatibilityGate(schemaVersion: number): void {
    if (!this.runtime || !shouldRepairCompatibilityGate(schemaVersion)) return

    const userDataDir = this.pathProvider.getUserDataDir()
    const meta = readDataDirCompatibilityMeta(userDataDir)
    const missingGate = CHAT_DB_COMPATIBILITY_RAISES.find(
      ({ migrationVersion, minRuntimeVersion, dataCompatibilityVersion, reason }) =>
        schemaVersion >= migrationVersion &&
        (!meta ||
          !isRuntimeVersionAtLeast(meta.minRuntimeVersion, minRuntimeVersion) ||
          meta.dataCompatibilityVersion < dataCompatibilityVersion ||
          !meta.reasons.includes(reason))
    )
    if (!missingGate) return

    throw new DataDirCompatibilityError(
      'DATA_DIR_COMPATIBILITY_REPAIR_REQUIRED',
      `ChatLab session schema v${schemaVersion} requires an updated data-directory compatibility marker. ` +
        'Open the data directory with the current writable ChatLab runtime to repair it before using read-only MCP tools.',
      {
        userDataDir,
        metaPath: path.join(userDataDir, '.chatlab-meta.json'),
        currentVersion: this.runtime.version,
        minRuntimeVersion: missingGate.minRuntimeVersion,
      }
    )
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
