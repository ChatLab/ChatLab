import type { DatabaseAdapter, PreparedStatement as CorePreparedStatement, RunResult } from '@openchatlab/core'
import type {
  BindingSpec,
  Database as Oo1Database,
  PreparedStatement as Oo1PreparedStatement,
  Sqlite3Static,
} from '@sqlite.org/sqlite-wasm'

class SqliteWasmPreparedStatement implements CorePreparedStatement {
  readonly?: boolean
  private finalized = false

  constructor(
    private readonly sqlite3: Sqlite3Static,
    private readonly db: Oo1Database,
    private readonly statement: Oo1PreparedStatement
  ) {
    this.readonly = statement.pointer ? sqlite3.capi.sqlite3_stmt_readonly(statement.pointer) === 1 : undefined
  }

  get(...params: unknown[]): Record<string, unknown> | undefined {
    return this.withBindings(params, () => {
      if (!this.statement.step()) return undefined
      return this.statement.get({}) as Record<string, unknown>
    })
  }

  all(...params: unknown[]): Record<string, unknown>[] {
    return this.withBindings(params, () => {
      const rows: Record<string, unknown>[] = []
      while (this.statement.step()) {
        rows.push(this.statement.get({}) as Record<string, unknown>)
      }
      return rows
    })
  }

  run(...params: unknown[]): RunResult {
    return this.withBindings(params, () => {
      this.statement.step()
      return {
        changes: this.db.changes(),
        lastInsertRowid: this.sqlite3.capi.sqlite3_last_insert_rowid(this.db),
      }
    })
  }

  finalize(): void {
    if (this.finalized) return
    this.finalized = true
    this.statement.finalize()
  }

  private withBindings<T>(params: unknown[], operation: () => T): T {
    try {
      if (params.length > 0) {
        const bindings =
          params.length === 1 && isNamedBindings(params[0]) ? this.normalizeNamedBindings(params[0]) : params
        this.statement.bind(bindings as BindingSpec)
      }
      return operation()
    } finally {
      this.statement.reset(true)
    }
  }

  private normalizeNamedBindings(bindings: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(bindings).map(([name, value]) => {
        if (/^[:@$]/.test(name)) return [name, value]
        const parameterName = [`:${name}`, `@${name}`, `$${name}`].find(
          (candidate) => (this.statement.getParamIndex(candidate) ?? 0) > 0
        )
        return [parameterName ?? name, value]
      })
    )
  }
}

function isNamedBindings(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Uint8Array)
}

export class SqliteWasmDatabaseAdapter implements DatabaseAdapter {
  readonly?: boolean
  private readonly statements = new Set<SqliteWasmPreparedStatement>()

  constructor(
    private readonly sqlite3: Sqlite3Static,
    private readonly db: Oo1Database
  ) {
    this.readonly = db.pointer ? sqlite3.capi.sqlite3_db_readonly(db, 'main') === 1 : undefined
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  prepare(sql: string): CorePreparedStatement {
    const statement = new SqliteWasmPreparedStatement(this.sqlite3, this.db, this.db.prepare(sql))
    this.statements.add(statement)
    return statement
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // Preserve the original transaction error.
      }
      throw error
    }
  }

  pragma(pragma: string): unknown {
    return this.db.selectObjects(`PRAGMA ${pragma}`)
  }

  close(): void {
    for (const statement of this.statements) statement.finalize()
    this.statements.clear()
    this.db.close()
  }
}
