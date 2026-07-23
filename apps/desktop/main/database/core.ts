/**
 * 数据库核心模块
 * 负责数据库的打开和迁移检查
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import type { RuntimeIdentity } from '@openchatlab/node-runtime/src/data-dir-compat'
import { migrateDatabase, needsMigration, CURRENT_SCHEMA_VERSION } from './migrations'
import { getPathProvider } from '../paths/provider'
import { ensureDir } from '../paths/locations'
import { resolveDesktopNativeBinding } from '../runtime/native-sqlite'

/**
 * 获取数据库目录
 */
function getDbDir(): string {
  return getPathProvider().getDatabaseDir()
}

/**
 * 确保数据库目录存在
 */
function ensureDbDir(): void {
  ensureDir(getDbDir())
}

/**
 * 获取数据库文件路径
 */
function getDbPath(sessionId: string): string {
  return path.join(getDbDir(), `${sessionId}.db`)
}

/**
 * 打开已存在的数据库
 * @param readonly 是否只读模式（默认 true）
 */
export function openDatabase(sessionId: string, readonly = true): Database.Database | null {
  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) {
    return null
  }
  const db = new Database(dbPath, { readonly, nativeBinding: resolveDesktopNativeBinding() })
  if (!readonly) db.pragma('journal_mode = WAL')
  return db
}

/**
 * 打开数据库并执行迁移（如果需要）
 * 用于需要写入的场景
 * @param sessionId 会话ID
 * @param forceRepair 是否强制修复（即使版本号已是最新也重新执行迁移脚本）
 */
function openDatabaseWithMigration(
  sessionId: string,
  forceRepair = false,
  runtime?: RuntimeIdentity
): Database.Database | null {
  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) {
    return null
  }

  const db = new Database(dbPath, { nativeBinding: resolveDesktopNativeBinding() })
  db.pragma('journal_mode = WAL')

  // 执行迁移
  migrateDatabase(db, forceRepair, { pathProvider: getPathProvider(), runtime })

  return db
}

/**
 * 检查是否有数据库需要迁移
 * @returns 需要迁移的数据库数量、列表、最低版本和需要强制修复的列表
 */
export function checkMigrationNeeded(): {
  count: number
  sessionIds: string[]
  lowestVersion: number
  forceRepairIds: string[]
} {
  ensureDbDir()
  const dbDir = getDbDir()
  const files = fs.readdirSync(dbDir).filter((f) => f.endsWith('.db'))
  const needsMigrationList: string[] = []
  const forceRepairList: string[] = []
  let lowestVersion = CURRENT_SCHEMA_VERSION

  for (const file of files) {
    const sessionId = file.replace('.db', '')
    const dbPath = getDbPath(sessionId)

    try {
      const db = new Database(dbPath, { readonly: true, nativeBinding: resolveDesktopNativeBinding() })

      // 仅迁移聊天会话数据库：这里最小依赖是 meta + message
      // 这样可跳过非聊天库，同时避免把 member 缺失的异常库直接误归为“非聊天库”
      const requiredTableCount = db
        .prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name IN ('meta', 'message')")
        .get() as { cnt: number }
      const isChatSessionDb = requiredTableCount.cnt === 2
      if (!isChatSessionDb) {
        db.close()
        continue
      }

      // 获取当前 schema_version
      const metaTableInfo = db.prepare('PRAGMA table_info(meta)').all() as Array<{ name: string }>
      const hasVersionColumn = metaTableInfo.some((col) => col.name === 'schema_version')
      let dbVersion = 0
      if (hasVersionColumn) {
        const result = db.prepare('SELECT schema_version FROM meta LIMIT 1').get() as
          | { schema_version: number | null }
          | undefined
        dbVersion = result?.schema_version ?? 0
      }

      // 检查 message 表是否有 reply_to_message_id 列
      const messageTableInfo = db.prepare('PRAGMA table_info(message)').all() as Array<{ name: string }>
      const hasReplyColumn = messageTableInfo.some((col) => col.name === 'reply_to_message_id')

      if (needsMigration(db)) {
        needsMigrationList.push(sessionId)
        lowestVersion = Math.min(lowestVersion, dbVersion)
      } else if (!hasReplyColumn) {
        // 特殊情况：版本号已更新但列不存在，需要强制修复
        needsMigrationList.push(sessionId)
        forceRepairList.push(sessionId)
        lowestVersion = Math.min(lowestVersion, dbVersion)
      }

      db.close()
    } catch (error) {
      console.error(`[Database] Failed to check migration for ${file}:`, error)
    }
  }

  return {
    count: needsMigrationList.length,
    sessionIds: needsMigrationList,
    lowestVersion,
    forceRepairIds: forceRepairList,
  }
}

/**
 * 迁移失败的数据库信息
 */
interface MigrationFailure {
  sessionId: string
  error: string
}

/**
 * 执行所有数据库的迁移
 * 即使部分数据库迁移失败，也会继续处理其他数据库
 * @returns 迁移结果，包含成功数量和失败列表
 */
export function migrateAllDatabases(): {
  success: boolean
  migratedCount: number
  failures: MigrationFailure[]
  error?: string
}
export function migrateAllDatabases(runtime: RuntimeIdentity): {
  success: boolean
  migratedCount: number
  failures: MigrationFailure[]
  error?: string
}
export function migrateAllDatabases(runtime?: RuntimeIdentity): {
  success: boolean
  migratedCount: number
  failures: MigrationFailure[]
  error?: string
} {
  const { sessionIds, forceRepairIds } = checkMigrationNeeded()
  const forceRepairSet = new Set(forceRepairIds)

  if (sessionIds.length === 0) {
    return { success: true, migratedCount: 0, failures: [] }
  }

  let migratedCount = 0
  const failures: MigrationFailure[] = []

  for (const sessionId of sessionIds) {
    try {
      const needsForceRepair = forceRepairSet.has(sessionId)
      const db = openDatabaseWithMigration(sessionId, needsForceRepair, runtime)
      if (db) {
        db.close()
        migratedCount++
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`[Database] Failed to migrate ${sessionId}:`, errorMessage)
      failures.push({ sessionId, error: errorMessage })
    }
  }

  // 如果有失败的数据库，返回部分成功状态
  if (failures.length > 0) {
    const failedIds = failures.map((f) => f.sessionId.split('_').slice(-1)[0]).join(', ')
    return {
      success: false,
      migratedCount,
      failures,
      error: `${failures.length} 个数据库迁移失败（ID: ${failedIds}）。建议在侧边栏中删除这些损坏的会话。`,
    }
  }

  return { success: true, migratedCount, failures: [] }
}
