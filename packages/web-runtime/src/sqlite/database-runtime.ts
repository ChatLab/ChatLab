import { CHAT_DB_INDEXES, CHAT_DB_TABLES, CURRENT_SCHEMA_VERSION, type DatabaseAdapter } from '@openchatlab/core'
import type { OpenDatabaseResult } from '../rpc/protocol'
import { WebRuntimeError } from '../runtime-error'
import type { WorkspaceDatabaseStage } from '../storage/workspace-database'
import { SqliteWasmDatabaseAdapter } from './adapter'
import { initializeOpfsSqlite, type InitializedSqliteRuntime, type SqliteInitializationStage } from './opfs'
import {
  acquireWebRuntimeWorkspaceLease,
  getWebRuntimeLockManager,
  type WebRuntimeLockManager,
  type WebRuntimeWorkspaceLease,
} from './workspace-lease'

export type DatabaseOpenStage = WorkspaceDatabaseStage

export class BrowserDatabaseRuntime {
  private initialized: Promise<InitializedSqliteRuntime> | undefined
  private database: DatabaseAdapter | undefined
  private filename: string | undefined
  private workspaceLease: WebRuntimeWorkspaceLease | undefined
  private workspaceRuntime: InitializedSqliteRuntime | undefined
  private workspaceLeaseDepth = 0

  constructor(
    private readonly initializeSqlite: (
      onStage?: (stage: SqliteInitializationStage) => void
    ) => Promise<InitializedSqliteRuntime> = initializeOpfsSqlite,
    private readonly lockManager: WebRuntimeLockManager | undefined = getWebRuntimeLockManager()
  ) {}

  async open(filename: string, onStage?: (stage: DatabaseOpenStage) => void): Promise<OpenDatabaseResult> {
    return this.withWorkspaceLease(async () => {
      validateDatabaseFilename(filename)

      if (this.database) {
        if (this.filename === filename) return this.buildOpenResult(filename, await this.getInitializedRuntime())
        throw new WebRuntimeError(
          'DATABASE_ALREADY_OPEN',
          `Database ${this.filename ?? '(unknown)'} is already open; close it before opening another database`
        )
      }

      const runtime = await this.getInitializedRuntime(onStage)
      onStage?.('opfs-database-opening')
      const rawDatabase = new runtime.pool.OpfsSAHPoolDb(filename)
      const database = new SqliteWasmDatabaseAdapter(runtime.sqlite3, rawDatabase)
      onStage?.('opfs-database-opened')

      try {
        database.pragma('foreign_keys = ON')
        onStage?.('schema-initializing')
        database.exec(CHAT_DB_TABLES)
        database.exec(CHAT_DB_INDEXES)
        onStage?.('schema-ready')
      } catch (error) {
        try {
          database.close()
        } catch {
          // Keep the schema error as the primary failure.
        }
        throw new WebRuntimeError('SCHEMA_INITIALIZATION_FAILED', 'Could not initialize the browser database schema', {
          cause: error,
        })
      }

      this.database = database
      this.filename = filename
      return this.buildOpenResult(filename, runtime)
    }, onStage)
  }

  async close(onStage?: (stage: DatabaseOpenStage) => void): Promise<{ closed: boolean }> {
    return this.withWorkspaceLease(async () => {
      if (!this.database) return { closed: false }
      const database = this.database
      database.close()
      this.database = undefined
      this.filename = undefined
      return { closed: true }
    }, onStage)
  }

  async withWorkspaceLease<T>(
    operation: () => Promise<T>,
    onStage?: (stage: DatabaseOpenStage) => void,
    signal?: AbortSignal
  ): Promise<T> {
    await this.acquireWorkspaceLease(onStage, signal)
    this.workspaceLeaseDepth += 1
    let operationFailed = false
    let operationError: unknown
    let result!: T

    try {
      signal?.throwIfAborted()
      result = await operation()
    } catch (error) {
      operationFailed = true
      operationError = error
    }

    this.workspaceLeaseDepth -= 1
    if (this.workspaceLeaseDepth === 0 && !this.database) {
      try {
        await this.releaseWorkspaceLease(onStage)
      } catch (releaseError) {
        if (!operationFailed) throw releaseError
      }
    }

    if (operationFailed) throw operationError
    return result
  }

  async withDatabase<T>(
    filename: string,
    schemaSql: string,
    operation: (db: DatabaseAdapter) => T,
    onStage?: (stage: WorkspaceDatabaseStage) => void
  ): Promise<T> {
    return this.withWorkspaceLease(async () => {
      validateDatabaseFilename(filename)
      if (this.database) {
        throw new WebRuntimeError(
          'DATABASE_ALREADY_OPEN',
          `Database ${this.filename ?? '(unknown)'} is already open; close it before running a workspace operation`
        )
      }

      const runtime = await this.getInitializedRuntime(onStage)
      onStage?.('opfs-database-opening')
      const rawDatabase = new runtime.pool.OpfsSAHPoolDb(filename)
      const database = new SqliteWasmDatabaseAdapter(runtime.sqlite3, rawDatabase)
      onStage?.('opfs-database-opened')
      let operationFailed = false
      let operationError: unknown
      let result!: T

      try {
        database.pragma('foreign_keys = ON')
        onStage?.('schema-initializing')
        database.exec(schemaSql)
        onStage?.('schema-ready')
        result = operation(database)
      } catch (error) {
        operationFailed = true
        operationError = error
      }

      try {
        database.close()
      } catch (closeError) {
        if (!operationFailed) throw closeError
      }
      if (operationFailed) throw operationError
      return result
    }, onStage)
  }

  async deleteDatabase(filename: string): Promise<boolean> {
    return this.withWorkspaceLease(async () => {
      validateDatabaseFilename(filename)
      if (this.filename === filename) {
        throw new WebRuntimeError(
          'DATABASE_ALREADY_OPEN',
          `Database ${filename} must be closed before it can be deleted`
        )
      }
      const runtime = await this.getInitializedRuntime()
      return runtime.pool.unlink(filename)
    })
  }

  async ensureCapacity(minimum: number): Promise<number> {
    return this.withWorkspaceLease(async () => {
      const runtime = await this.getInitializedRuntime()
      return runtime.pool.reserveMinimumCapacity(minimum)
    })
  }

  async getDatabaseFilenames(): Promise<string[]> {
    return this.withWorkspaceLease(async () => {
      const runtime = await this.getInitializedRuntime()
      return runtime.pool.getFileNames()
    })
  }

  getOpenDatabase(): DatabaseAdapter {
    if (!this.database) throw new WebRuntimeError('DATABASE_NOT_OPEN', 'No database is open')
    return this.database
  }

  private async getInitializedRuntime(
    onStage?: (stage: SqliteInitializationStage) => void
  ): Promise<InitializedSqliteRuntime> {
    const initialized = (this.initialized ??= this.initializeSqlite(onStage))
    try {
      return await initialized
    } catch (error) {
      if (this.initialized === initialized) this.initialized = undefined
      throw error
    }
  }

  private async acquireWorkspaceLease(
    onStage?: (stage: DatabaseOpenStage) => void,
    signal?: AbortSignal
  ): Promise<void> {
    if (this.workspaceLease) return

    onStage?.('opfs-workspace-lock-waiting')
    const lease = await acquireWebRuntimeWorkspaceLease(this.lockManager, signal)

    try {
      onStage?.('opfs-workspace-lock-acquired')
      const runtime = await this.getInitializedRuntime(onStage)
      if (runtime.pool.isPaused()) {
        onStage?.('opfs-pool-resuming')
        await runtime.pool.unpauseVfs()
        onStage?.('opfs-pool-resumed')
      }
      this.workspaceLease = lease
      this.workspaceRuntime = runtime
    } catch (error) {
      lease.release()
      throw error
    }
  }

  private async releaseWorkspaceLease(onStage?: (stage: DatabaseOpenStage) => void): Promise<void> {
    const lease = this.workspaceLease
    const runtime = this.workspaceRuntime
    if (!lease) return

    if (runtime && !runtime.pool.isPaused()) {
      onStage?.('opfs-pool-pausing')
      runtime.pool.pauseVfs()
      onStage?.('opfs-pool-paused')
    }

    this.workspaceLease = undefined
    this.workspaceRuntime = undefined
    lease.release()
    onStage?.('opfs-workspace-lock-released')
  }

  private buildOpenResult(filename: string, runtime: InitializedSqliteRuntime): OpenDatabaseResult {
    return {
      filename,
      sqliteVersion: runtime.sqlite3.version.libVersion,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    }
  }
}

function validateDatabaseFilename(filename: string): void {
  if (!filename.startsWith('/')) {
    throw new WebRuntimeError('INVALID_DATABASE_FILENAME', 'The opfs-sahpool database filename must be absolute')
  }
  if (filename === '/' || filename.includes('\0') || filename.split('/').includes('..')) {
    throw new WebRuntimeError('INVALID_DATABASE_FILENAME', 'The database filename is not valid')
  }
}
