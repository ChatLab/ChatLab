/**
 * SQL 实验室查询模块
 * 提供用户自定义 SQL 查询功能
 */

import { openDatabase } from '../core'

/**
 * SQL 执行结果
 */
export interface SQLResult {
  columns: string[]
  rows: any[][]
  rowCount: number
  duration: number
  limited: boolean // 是否被截断
}

/**
 * 表结构信息
 */
export interface TableSchema {
  name: string
  columns: {
    name: string
    type: string
    notnull: boolean
    pk: boolean
  }[]
}

/**
 * 获取数据库 Schema
 */
export function getSchema(sessionId: string): TableSchema[] {
  const db = openDatabase(sessionId)
  if (!db) {
    throw new Error('数据库不存在')
  }

  // 获取所有表名
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type='table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`
    )
    .all() as { name: string }[]

  const schema: TableSchema[] = []

  for (const table of tables) {
    // 获取表的列信息
    const columns = db.prepare(`PRAGMA table_info('${table.name}')`).all() as {
      cid: number
      name: string
      type: string
      notnull: number
      dflt_value: any
      pk: number
    }[]

    schema.push({
      name: table.name,
      columns: columns.map((col) => ({
        name: col.name,
        type: col.type,
        notnull: col.notnull === 1,
        pk: col.pk === 1,
      })),
    })
  }

  return schema
}

/**
 * 插件专用：参数化只读 SQL 查询
 * - 强制 stmt.readonly 检查（better-sqlite3 原生特性）
 * - 参数化执行（防注入 + 预编译缓存）
 */
export function executePluginQuery<T = Record<string, any>>(
  sessionId: string,
  sql: string,
  params: any[] | Record<string, any> = []
): T[] {
  const db = openDatabase(sessionId)
  if (!db) {
    throw new Error('数据库不存在')
  }

  const stmt = db.prepare(sql.trim())

  // 安全防线：强制只读检查
  if (!stmt.readonly) {
    throw new Error('Plugin Security Violation: Only READ-ONLY statements are allowed.')
  }

  // better-sqlite3 支持位置参数（数组展开）和命名参数（对象）
  if (Array.isArray(params)) {
    return stmt.all(...params) as T[]
  }
  return stmt.all(params) as T[]
}

/**
 * 执行用户 SQL 查询
 * - 只支持 SELECT 语句
 * - 不强制 LIMIT，由用户自行控制
 * - 带超时控制（由 Worker 管理器控制）
 */
export function executeRawSQL(sessionId: string, sql: string): SQLResult {
  const db = openDatabase(sessionId)
  if (!db) {
    throw new Error('数据库不存在')
  }

  const trimmedSQL = sql.trim()

  // 只允许 SELECT 语句
  if (!trimmedSQL.toUpperCase().startsWith('SELECT')) {
    throw new Error('只支持 SELECT 查询语句')
  }

  // 执行查询
  const startTime = Date.now()

  try {
    // better-sqlite3 是同步的，超时由 Worker 管理器控制
    const stmt = db.prepare(trimmedSQL)
    const rows = stmt.all()
    const duration = Date.now() - startTime

    // 获取列名
    const columns = stmt.columns().map((col) => col.name)

    // 将结果转换为二维数组
    const rowData = rows.map((row: any) => columns.map((col) => row[col]))

    return {
      columns,
      rows: rowData,
      rowCount: rows.length,
      duration,
      limited: false, // 不再强制限制
    }
  } catch (error) {
    if (error instanceof Error) {
      // 美化错误信息
      const message = error.message.replace(/^SQLITE_ERROR: /, '').replace(/^SQLITE_READONLY: /, '只读模式：')
      throw new Error(message)
    }
    throw error
  }
}
