/**
 * 会话模块核心工具函数
 * 提供数据库连接等共享功能
 */

import type Database from 'better-sqlite3'
import { getDbPath, openRawDatabase, closeDatabase } from '../../core'

// 重新导出 closeDatabase 供其他模块使用
export { closeDatabase }

/**
 * 打开数据库（可写模式，不使用缓存）
 * 会话索引需要写入数据
 */
export function openWritableDatabase(sessionId: string): Database.Database | null {
  try {
    return openRawDatabase(getDbPath(sessionId))
  } catch {
    return null
  }
}

/**
 * 打开数据库（只读模式，不使用缓存）
 */
export function openReadonlyDatabase(sessionId: string): Database.Database | null {
  try {
    return openRawDatabase(getDbPath(sessionId), { readonly: true })
  } catch {
    return null
  }
}
