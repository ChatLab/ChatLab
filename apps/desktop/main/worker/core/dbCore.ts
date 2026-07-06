/**
 * 数据库核心工具模块
 * 提供数据库连接管理和通用工具函数
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import type { DatabaseAdapter, PreparedStatement, RunResult } from '@openchatlab/core'

let DB_DIR: string = ''
let CACHE_DIR: string = ''
let TEMP_DIR: string = ''
// Electron-ABI better-sqlite3 绑定路径（由主进程经 workerData 注入；测试/生产为 undefined）
let NATIVE_BINDING: string | undefined

// 数据库连接缓存
const dbCache = new Map<string, Database.Database>()

export function initDbDir(dir: string, cacheDir?: string, tempDir?: string, nativeBinding?: string): void {
  DB_DIR = dir
  if (cacheDir) CACHE_DIR = cacheDir
  if (tempDir) TEMP_DIR = tempDir
  NATIVE_BINDING = nativeBinding
}

/**
 * 打开一个非缓存的数据库连接 —— worker 内唯一合法的 better-sqlite3 构造入口。
 *
 * 统一携带主进程注入的 Electron-ABI nativeBinding（否则 dev 环境会加载
 * node_modules 里的 Node ABI 绑定并触发 NODE_MODULE_VERSION 报错）并启用 WAL；
 * 额外的写优化 pragma（synchronous / cache_size）由调用方按需设置。
 */
export function openRawDatabase(dbPath: string, options: { readonly?: boolean } = {}): Database.Database {
  const db = new Database(dbPath, { ...options, nativeBinding: NATIVE_BINDING })
  db.pragma('journal_mode = WAL')
  return db
}

/**
 * 获取数据库文件路径
 */
export function getDbPath(sessionId: string): string {
  return path.join(DB_DIR, `${sessionId}.db`)
}

/**
 * 打开数据库（带缓存）
 */
export function openDatabase(sessionId: string): Database.Database | null {
  // 检查缓存
  if (dbCache.has(sessionId)) {
    return dbCache.get(sessionId)!
  }

  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) {
    return null
  }

  const db = openRawDatabase(dbPath, { readonly: true })

  // 缓存连接
  dbCache.set(sessionId, db)
  return db
}

/**
 * 关闭指定会话的数据库连接
 */
export function closeDatabase(sessionId: string): void {
  const db = dbCache.get(sessionId)
  if (db) {
    db.close()
    dbCache.delete(sessionId)
  }
}

/**
 * 关闭所有数据库连接
 */
export function closeAllDatabases(): void {
  for (const [sessionId, db] of dbCache.entries()) {
    db.close()
    dbCache.delete(sessionId)
  }
}

/**
 * 获取数据库目录
 */
export function getDbDir(): string {
  return DB_DIR
}

export function getCacheDir(): string {
  return CACHE_DIR
}

export function getTempDir(): string {
  return TEMP_DIR
}

// ==================== 时间过滤工具 ====================

// Re-export from shared-types
export type { TimeFilter } from '@openchatlab/shared-types'
import type { TimeFilter } from '@openchatlab/shared-types'

/**
 * 构建时间过滤 WHERE 子句
 * @param filter 时间过滤器（包含时间范围和成员筛选）
 * @param tableAlias 表别名，用于多表 JOIN 场景避免列名歧义（如 'msg'）
 */
export function buildTimeFilter(
  filter?: TimeFilter,
  tableAlias?: string
): { clause: string; params: (number | string)[] } {
  const conditions: string[] = []
  const params: (number | string)[] = []

  // 构建带别名的列名（如 'msg.ts' 或 'ts'）
  const tsColumn = tableAlias ? `${tableAlias}.ts` : 'ts'
  const senderIdColumn = tableAlias ? `${tableAlias}.sender_id` : 'sender_id'

  if (filter?.startTs !== undefined) {
    conditions.push(`${tsColumn} >= ?`)
    params.push(filter.startTs)
  }
  if (filter?.endTs !== undefined) {
    conditions.push(`${tsColumn} <= ?`)
    params.push(filter.endTs)
  }
  // 成员筛选
  if (filter?.memberId !== undefined && filter?.memberId !== null) {
    conditions.push(`${senderIdColumn} = ?`)
    params.push(filter.memberId)
  }

  return {
    clause: conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '',
    params,
  }
}

/**
 * 构建排除系统消息的过滤条件
 */
export function buildSystemMessageFilter(existingClause: string): string {
  // 系统消息过滤：account_name 不等于 '系统消息'
  const systemFilter = "COALESCE(m.account_name, '') != '系统消息'"

  if (existingClause.includes('WHERE')) {
    return existingClause + ' AND ' + systemFilter
  } else {
    return ' WHERE ' + systemFilter
  }
}

/**
 * 将 better-sqlite3.Database 实例包装为 DatabaseAdapter 接口
 */
export function wrapAsDatabaseAdapter(db: Database.Database): DatabaseAdapter {
  return {
    readonly: db.readonly,
    exec(sql: string) {
      db.exec(sql)
    },
    prepare(sql: string): PreparedStatement {
      const stmt = db.prepare(sql)
      return {
        readonly: stmt.readonly,
        get(...params: unknown[]) {
          return stmt.get(...params) as Record<string, unknown> | undefined
        },
        all(...params: unknown[]) {
          return stmt.all(...params) as Record<string, unknown>[]
        },
        run(...params: unknown[]): RunResult {
          const result = stmt.run(...params)
          return { changes: result.changes, lastInsertRowid: result.lastInsertRowid }
        },
      }
    },
    transaction<T>(fn: () => T): T {
      return db.transaction(fn)()
    },
    pragma(pragma: string) {
      return db.pragma(pragma)
    },
    close() {
      db.close()
    },
  }
}

/**
 * 打开数据库并返回 DatabaseAdapter（用于调用 @openchatlab/core 查询函数）
 */
export function openDatabaseAdapter(sessionId: string): DatabaseAdapter | null {
  const db = openDatabase(sessionId)
  if (!db) return null
  return wrapAsDatabaseAdapter(db)
}
