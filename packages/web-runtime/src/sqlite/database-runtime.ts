import { CHAT_DB_INDEXES, CHAT_DB_TABLES, CURRENT_SCHEMA_VERSION, type DatabaseAdapter } from '@openchatlab/core'
import type { OpenDatabaseResult } from '../rpc/protocol'
import { WebRuntimeError } from '../runtime-error'
import type { WorkspaceDatabaseStage } from '../storage/workspace-database'
import { SqliteWasmDatabaseAdapter } from './adapter'
import { initializeOpfsSqlite, type InitializedSqliteRuntime, type SqliteInitializationStage } from './opfs'

export type DatabaseOpenStage = WorkspaceDatabaseStage

export class BrowserDatabaseRuntime {
  private initialized: Promise<InitializedSqliteRuntime> | undefined
  private database: DatabaseAdapter | undefined
  private filename: string | undefined

  constructor(
    private readonly initializeSqlite: (
      onStage?: (stage: SqliteInitializationStage) => void
    ) => Promise<InitializedSqliteRuntime> = initializeOpfsSqlite
  ) {}

  async open(filename: string, onStage?: (stage: DatabaseOpenStage) => void): Promise<OpenDatabaseResult> {
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
  }

  async close(): Promise<{ closed: boolean }> {
    if (!this.database) return { closed: false }
    const database = this.database
    database.close()
    this.database = undefined
    this.filename = undefined
    return { closed: true }
  }

  async withDatabase<T>(
    filename: string,
    schemaSql: string,
    operation: (db: DatabaseAdapter) => T,
    onStage?: (stage: WorkspaceDatabaseStage) => void
  ): Promise<T> {
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
  }

  async deleteDatabase(filename: string): Promise<boolean> {
    validateDatabaseFilename(filename)
    if (this.filename === filename) {
      throw new WebRuntimeError('DATABASE_ALREADY_OPEN', `Database ${filename} must be closed before it can be deleted`)
    }
    const runtime = await this.getInitializedRuntime()
    return runtime.pool.unlink(filename)
  }

  async ensureCapacity(minimum: number): Promise<number> {
    const runtime = await this.getInitializedRuntime()
    return runtime.pool.reserveMinimumCapacity(minimum)
  }

  async getDatabaseFilenames(): Promise<string[]> {
    const runtime = await this.getInitializedRuntime()
    return runtime.pool.getFileNames()
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
