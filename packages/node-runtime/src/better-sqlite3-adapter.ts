/**
 * DatabaseAdapter 的 better-sqlite3 实现
 *
 * 薄包装层：better-sqlite3 的 API 与 DatabaseAdapter 接口天然匹配，
 * 本适配器主要做类型桥接，几乎零额外逻辑。
 */

import Database from 'better-sqlite3'
import type { DatabaseAdapter, PreparedStatement, RunResult } from '@openchatlab/core'

class BetterSqlitePreparedStatement implements PreparedStatement {
  readonly?: boolean

  constructor(private stmt: Database.Statement) {
    this.readonly = stmt.readonly
  }

  get(...params: unknown[]): Record<string, unknown> | undefined {
    return this.stmt.get(...params) as Record<string, unknown> | undefined
  }

  all(...params: unknown[]): Record<string, unknown>[] {
    return this.stmt.all(...params) as Record<string, unknown>[]
  }

  run(...params: unknown[]): RunResult {
    const result = this.stmt.run(...params)
    return {
      changes: result.changes,
      lastInsertRowid: result.lastInsertRowid,
    }
  }
}

/**
 * 基于 better-sqlite3 的 DatabaseAdapter 实现
 */
export class BetterSqliteAdapter implements DatabaseAdapter {
  readonly?: boolean

  constructor(private db: Database.Database) {
    this.readonly = db.readonly
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  prepare(sql: string): PreparedStatement {
    return new BetterSqlitePreparedStatement(this.db.prepare(sql))
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  pragma(pragma: string): unknown {
    return this.db.pragma(pragma)
  }

  close(): void {
    this.db.close()
  }
}

/**
 * 从文件路径打开数据库并返回适配器
 *
 * @param options.nativeBinding - 指定 better-sqlite3 原生模块路径，
 *   用于在独立 Node.js 环境中加载与 Electron 隔离的二进制。
 */
export function openBetterSqliteDatabase(
  filePath: string,
  options?: { readonly?: boolean; nativeBinding?: string }
): BetterSqliteAdapter {
  const db = new Database(filePath, {
    readonly: options?.readonly ?? false,
    nativeBinding: options?.nativeBinding,
  })
  if (!options?.readonly) {
    db.pragma('journal_mode = WAL')
  }
  return new BetterSqliteAdapter(db)
}
