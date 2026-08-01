import Database from 'better-sqlite3'

import type { DatabaseAdapter, PreparedStatement, RunResult } from '../../interfaces'

class SqliteStatementAdapter implements PreparedStatement {
  readonly: boolean

  constructor(private readonly statement: Database.Statement) {
    this.readonly = statement.readonly
  }

  get(...params: unknown[]): Record<string, unknown> | undefined {
    return this.statement.get(...params) as Record<string, unknown> | undefined
  }

  all(...params: unknown[]): Record<string, unknown>[] {
    return this.statement.all(...params) as Record<string, unknown>[]
  }

  run(...params: unknown[]): RunResult {
    const result = this.statement.run(...params)
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid }
  }
}

export class SqliteTestAdapter implements DatabaseAdapter {
  constructor(readonly raw: Database.Database = new Database(':memory:')) {}

  exec(sql: string): void {
    this.raw.exec(sql)
  }

  prepare(sql: string): PreparedStatement {
    return new SqliteStatementAdapter(this.raw.prepare(sql))
  }

  transaction<T>(fn: () => T): T {
    return this.raw.transaction(fn)()
  }

  pragma(pragma: string): unknown {
    return this.raw.pragma(pragma)
  }

  close(): void {
    this.raw.close()
  }
}
