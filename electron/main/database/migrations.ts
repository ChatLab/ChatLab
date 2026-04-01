/**
 * 数据库迁移系统
 *
 * 用于管理数据库 schema 的版本升级。
 * 每次添加新字段或修改表结构时，创建一个新的迁移脚本。
 *
 * 使用方式：
 * 1. 在 migrations 数组中添加新的迁移对象
 * 2. version 必须递增
 * 3. up 函数执行迁移逻辑
 */

import type Database from 'better-sqlite3'
import { t } from '../i18n'

/** 迁移脚本接口 */
interface Migration {
  /** 版本号（必须递增） */
  version: number
  /** 迁移描述 i18n key（技术说明） */
  descriptionKey: string
  /** 用户可读的升级原因 i18n key（显示在弹窗中） */
  userMessageKey: string
  /** 迁移执行函数 */
  up: (db: Database.Database) => void
}

/** 导出给前端使用的迁移信息 */
export interface MigrationInfo {
  version: number
  /** 技术描述（面向开发者） */
  description: string
  /** 用户可读的升级原因（显示在弹窗中） */
  userMessage: string
}

/** 当前 schema 版本（最新迁移的版本号） */
export const CURRENT_SCHEMA_VERSION = 3

/**
 * 迁移脚本列表
 * 注意：版本号必须递增，每个迁移只执行一次
 */
const migrations: Migration[] = [
  {
    version: 1,
    descriptionKey: 'database.migrationV1Desc',
    userMessageKey: 'database.migrationV1Message',
    up: (db) => {
      // 检查 owner_id 列是否已存在（防止重复执行）
      const tableInfo = db.prepare('PRAGMA table_info(meta)').all() as Array<{ name: string }>
      const hasOwnerIdColumn = tableInfo.some((col) => col.name === 'owner_id')
      if (!hasOwnerIdColumn) {
        db.exec('ALTER TABLE meta ADD COLUMN owner_id TEXT')
      }
    },
  },
  {
    version: 2,
    descriptionKey: 'database.migrationV2Desc',
    userMessageKey: 'database.migrationV2Message',
    up: (db) => {
      // 检查 roles 列是否已存在（防止重复执行）
      const memberTableInfo = db.prepare('PRAGMA table_info(member)').all() as Array<{ name: string }>
      const hasRolesColumn = memberTableInfo.some((col) => col.name === 'roles')
      if (!hasRolesColumn) {
        db.exec("ALTER TABLE member ADD COLUMN roles TEXT DEFAULT '[]'")
      }

      // 检查 message 表的列
      const messageTableInfo = db.prepare('PRAGMA table_info(message)').all() as Array<{ name: string }>

      // 检查 reply_to_message_id 列是否已存在
      const hasReplyColumn = messageTableInfo.some((col) => col.name === 'reply_to_message_id')
      if (!hasReplyColumn) {
        db.exec('ALTER TABLE message ADD COLUMN reply_to_message_id TEXT DEFAULT NULL')
      }

      // 添加 platform_message_id 列（存储平台原始消息 ID，用于回复关联查询）
      const hasPlatformMsgIdColumn = messageTableInfo.some((col) => col.name === 'platform_message_id')
      if (!hasPlatformMsgIdColumn) {
        db.exec('ALTER TABLE message ADD COLUMN platform_message_id TEXT DEFAULT NULL')
      }

      // 创建索引以加速回复查询
      try {
        db.exec('CREATE INDEX IF NOT EXISTS idx_message_platform_id ON message(platform_message_id)')
      } catch {
        // 索引可能已存在
      }
    },
  },
  {
    version: 3,
    descriptionKey: 'database.migrationV3Desc',
    userMessageKey: 'database.migrationV3Message',
    up: (db) => {
      // 创建 chat_session 会话表
      db.exec(`
        CREATE TABLE IF NOT EXISTS chat_session (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          start_ts INTEGER NOT NULL,
          end_ts INTEGER NOT NULL,
          message_count INTEGER DEFAULT 0,
          is_manual INTEGER DEFAULT 0,
          summary TEXT
        )
      `)

      // 创建会话时间索引
      try {
        db.exec('CREATE INDEX IF NOT EXISTS idx_session_time ON chat_session(start_ts, end_ts)')
      } catch {
        // 索引可能已存在
      }

      // 创建 message_context 消息上下文表（预留 topic_id）
      db.exec(`
        CREATE TABLE IF NOT EXISTS message_context (
          message_id INTEGER PRIMARY KEY,
          session_id INTEGER NOT NULL,
          topic_id INTEGER
        )
      `)

      // 创建 session_id 索引
      try {
        db.exec('CREATE INDEX IF NOT EXISTS idx_context_session ON message_context(session_id)')
      } catch {
        // 索引可能已存在
      }

      // 检查 meta 表是否已有 session_gap_threshold 列
      const tableInfo = db.prepare('PRAGMA table_info(meta)').all() as Array<{ name: string }>
      const hasGapThresholdColumn = tableInfo.some((col) => col.name === 'session_gap_threshold')
      if (!hasGapThresholdColumn) {
        db.exec('ALTER TABLE meta ADD COLUMN session_gap_threshold INTEGER')
      }
    },
  },
]

/**
 * 获取数据库的 schema 版本
 * 如果没有版本信息，返回 0
 */
function getSchemaVersion(db: Database.Database): number {
  try {
    // 检查 meta 表是否有 schema_version 列
    const tableInfo = db.prepare('PRAGMA table_info(meta)').all() as Array<{ name: string }>
    const hasVersionColumn = tableInfo.some((col) => col.name === 'schema_version')

    if (!hasVersionColumn) {
      return 0
    }

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
function setSchemaVersion(db: Database.Database, version: number): void {
  // 检查 schema_version 列是否存在
  const tableInfo = db.prepare('PRAGMA table_info(meta)').all() as Array<{ name: string }>
  const hasVersionColumn = tableInfo.some((col) => col.name === 'schema_version')

  if (!hasVersionColumn) {
    // 添加 schema_version 列
    db.exec('ALTER TABLE meta ADD COLUMN schema_version INTEGER DEFAULT 0')
  }

  // 更新版本号
  db.prepare('UPDATE meta SET schema_version = ?').run(version)
}

/**
 * 检查数据库结构是否完整（meta 表必须存在）
 * 如果 meta 表不存在，说明数据库损坏或不完整
 */
function checkDatabaseIntegrity(db: Database.Database): { valid: boolean; error?: string } {
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'").all() as Array<{
      name: string
    }>

    if (tables.length === 0) {
      return {
        valid: false,
        error: t('database.integrityError'),
      }
    }
    return { valid: true }
  } catch (error) {
    return {
      valid: false,
      error: t('database.checkFailed', { error: error instanceof Error ? error.message : String(error) }),
    }
  }
}

/**
 * 执行数据库迁移
 * 自动检测当前版本并执行所有需要的迁移
 *
 * @param db 数据库连接
 * @param forceRepair 是否强制修复（即使版本号已是最新也重新执行迁移脚本）
 * @returns 是否执行了迁移
 * @throws 如果数据库结构不完整
 */
export function migrateDatabase(db: Database.Database, forceRepair = false): boolean {
  // 首先检查数据库结构完整性
  const integrity = checkDatabaseIntegrity(db)
  if (!integrity.valid) {
    throw new Error(integrity.error)
  }

  const currentVersion = getSchemaVersion(db)

  // 如果不是强制修复模式，检查版本号
  if (!forceRepair && currentVersion >= CURRENT_SCHEMA_VERSION) {
    return false
  }

  // 获取需要执行的迁移
  // 如果是强制修复，从 version 0 开始执行所有迁移
  const pendingMigrations = forceRepair ? migrations : migrations.filter((m) => m.version > currentVersion)

  if (pendingMigrations.length === 0) {
    return false
  }

  // 在事务中执行所有迁移
  const migrate = db.transaction(() => {
    for (const migration of pendingMigrations) {
      migration.up(db)
      setSchemaVersion(db, migration.version)
    }
  })

  migrate()
  return true
}

/**
 * 检查数据库是否需要迁移
 */
export function needsMigration(db: Database.Database): boolean {
  const currentVersion = getSchemaVersion(db)
  return currentVersion < CURRENT_SCHEMA_VERSION
}

/**
 * 获取待执行的迁移信息（用户可读）
 * @param fromVersion 起始版本（不含）
 */
export function getPendingMigrationInfos(fromVersion = 0): MigrationInfo[] {
  return migrations
    .filter((m) => m.version > fromVersion)
    .map((m) => ({
      version: m.version,
      description: t(m.descriptionKey),
      userMessage: t(m.userMessageKey),
    }))
}
