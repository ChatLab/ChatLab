/**
 * 数据库迁移框架（平台无关）
 *
 * 提供 Schema 版本检测和通用迁移执行逻辑。
 * 具体的迁移脚本由运行时注册，迁移本身只依赖 DatabaseAdapter。
 */

import type { DatabaseAdapter } from '../interfaces'

/** 迁移脚本接口 */
export interface Migration {
  version: number
  description: string
  up: (db: DatabaseAdapter) => void
}

/**
 * 读取数据库的 schema 版本
 */
export function getSchemaVersion(db: DatabaseAdapter): number {
  try {
    const tableInfo = db.pragma('table_info(meta)') as Array<{ name: string }>
    const hasVersionColumn = tableInfo.some((col) => col.name === 'schema_version')
    if (!hasVersionColumn) return 0

    const result = db.prepare('SELECT schema_version FROM meta LIMIT 1').get() as
      | { schema_version: number | null }
      | undefined
    return result?.schema_version ?? 0
  } catch {
    return 0
  }
}

/**
 * 设置数据库的 schema 版本
 */
export function setSchemaVersion(db: DatabaseAdapter, version: number): void {
  const tableInfo = db.pragma('table_info(meta)') as Array<{ name: string }>
  const hasVersionColumn = tableInfo.some((col) => col.name === 'schema_version')

  if (!hasVersionColumn) {
    db.exec('ALTER TABLE meta ADD COLUMN schema_version INTEGER DEFAULT 0')
  }

  db.prepare('UPDATE meta SET schema_version = ?').run(version)
}

/**
 * 检查数据库是否需要迁移
 */
export function needsMigration(db: DatabaseAdapter, targetVersion: number): boolean {
  return getSchemaVersion(db) < targetVersion
}

/**
 * 执行数据库迁移
 *
 * @param db 数据库适配器
 * @param migrationsList 迁移脚本列表（由调用方提供，可包含平台特定逻辑）
 * @param forceRepair 是否强制修复
 * @returns 是否执行了迁移
 */
export function runMigrations(db: DatabaseAdapter, migrationsList: Migration[], forceRepair = false): boolean {
  const currentVersion = getSchemaVersion(db)

  if (!forceRepair && currentVersion >= (migrationsList.at(-1)?.version ?? 0)) {
    return false
  }

  const pending = forceRepair ? migrationsList : migrationsList.filter((m) => m.version > currentVersion)

  if (pending.length === 0) return false

  db.transaction(() => {
    for (const migration of pending) {
      migration.up(db)
      setSchemaVersion(db, migration.version)
    }
  })

  return true
}
