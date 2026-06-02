/**
 * Chat session DB migration definitions (platform-agnostic).
 *
 * Extracted from electron/main/database/migrations.ts.
 * Migration scripts use only DatabaseAdapter — no Electron or Node-specific APIs.
 * Version 4 (FTS backfill) requires a tokenizer injected via MigrationDeps.
 */

import type { DatabaseAdapter } from '@openchatlab/core'
import type { Migration as CoreMigration } from '@openchatlab/core'

export interface MigrationDeps {
  /** FTS tokenizer — needed by v4 migration for backfilling the FTS index */
  tokenizeForFts?: (content: string) => string | null
}

/**
 * Build the chat DB migration list.
 *
 * @param deps Optional dependencies (tokenizer for FTS backfill)
 * @returns Array of migrations compatible with core `runMigrations`
 */
export function getChatDbMigrations(deps?: MigrationDeps): CoreMigration[] {
  const hasColumn = (db: DatabaseAdapter, tableName: string, columnName: string): boolean => {
    const tableInfo = db.pragma(`table_info(${tableName})`) as Array<{ name: string }>
    return tableInfo.some((col) => col.name === columnName)
  }

  const addColumnIfMissing = (db: DatabaseAdapter, tableName: string, columnName: string, definition: string): void => {
    if (!hasColumn(db, tableName, columnName)) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`)
    }
  }

  return [
    {
      version: 1,
      description: 'Add owner_id column to meta',
      up: (db: DatabaseAdapter) => {
        const tableInfo = db.pragma('table_info(meta)') as Array<{ name: string }>
        if (!tableInfo.some((col) => col.name === 'owner_id')) {
          db.exec('ALTER TABLE meta ADD COLUMN owner_id TEXT')
        }
      },
    },
    {
      version: 2,
      description: 'Add roles, reply_to_message_id, platform_message_id columns',
      up: (db: DatabaseAdapter) => {
        const memberTableInfo = db.pragma('table_info(member)') as Array<{ name: string }>
        if (!memberTableInfo.some((col) => col.name === 'roles')) {
          db.exec("ALTER TABLE member ADD COLUMN roles TEXT DEFAULT '[]'")
        }

        const messageTableInfo = db.pragma('table_info(message)') as Array<{ name: string }>

        if (!messageTableInfo.some((col) => col.name === 'reply_to_message_id')) {
          db.exec('ALTER TABLE message ADD COLUMN reply_to_message_id TEXT DEFAULT NULL')
        }

        if (!messageTableInfo.some((col) => col.name === 'platform_message_id')) {
          db.exec('ALTER TABLE message ADD COLUMN platform_message_id TEXT DEFAULT NULL')
        }

        try {
          db.exec('CREATE INDEX IF NOT EXISTS idx_message_platform_id ON message(platform_message_id)')
        } catch {
          // Index may already exist
        }
      },
    },
    {
      version: 3,
      description: 'Add chat_session and message_context tables',
      up: (db: DatabaseAdapter) => {
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

        try {
          db.exec('CREATE INDEX IF NOT EXISTS idx_session_time ON chat_session(start_ts, end_ts)')
        } catch {
          // Index may already exist
        }

        db.exec(`
          CREATE TABLE IF NOT EXISTS message_context (
            message_id INTEGER PRIMARY KEY,
            session_id INTEGER NOT NULL,
            topic_id INTEGER
          )
        `)

        try {
          db.exec('CREATE INDEX IF NOT EXISTS idx_context_session ON message_context(session_id)')
        } catch {
          // Index may already exist
        }

        const tableInfo = db.pragma('table_info(meta)') as Array<{ name: string }>
        if (!tableInfo.some((col) => col.name === 'session_gap_threshold')) {
          db.exec('ALTER TABLE meta ADD COLUMN session_gap_threshold INTEGER')
        }
      },
    },
    {
      version: 4,
      description: 'Add FTS5 full-text search index',
      up: (db: DatabaseAdapter) => {
        const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='message_fts'").get()
        if (hasTable) return

        db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
            content,
            content='',
            content_rowid=id
          )
        `)

        const tokenize = deps?.tokenizeForFts
        if (!tokenize) return

        const BATCH_SIZE = 5000
        const insertFts = db.prepare('INSERT INTO message_fts(rowid, content) VALUES (?, ?)')

        const countRow = db
          .prepare("SELECT COUNT(*) as total FROM message WHERE type = 0 AND content IS NOT NULL AND content != ''")
          .get() as { total: number } | undefined

        const total = countRow?.total ?? 0
        let offset = 0
        while (offset < total) {
          const rows = db
            .prepare(
              `SELECT id, content FROM message
               WHERE type = 0 AND content IS NOT NULL AND content != ''
               ORDER BY id ASC LIMIT ? OFFSET ?`
            )
            .all(BATCH_SIZE, offset) as Array<{ id: number; content: string }>

          if (rows.length === 0) break

          for (const row of rows) {
            const tokens = tokenize(row.content)
            if (tokens) {
              insertFts.run(row.id, tokens)
            }
          }

          offset += BATCH_SIZE
        }
      },
    },
    {
      version: 5,
      description: 'Repair legacy member/message columns',
      up: (db: DatabaseAdapter) => {
        addColumnIfMissing(db, 'meta', 'group_id', 'TEXT')
        addColumnIfMissing(db, 'meta', 'group_avatar', 'TEXT')
        addColumnIfMissing(db, 'meta', 'owner_id', 'TEXT')
        addColumnIfMissing(db, 'meta', 'session_gap_threshold', 'INTEGER')

        const memberHadName = hasColumn(db, 'member', 'name')
        const memberHadNickname = hasColumn(db, 'member', 'nickname')
        addColumnIfMissing(db, 'member', 'account_name', 'TEXT')
        addColumnIfMissing(db, 'member', 'group_nickname', 'TEXT')
        addColumnIfMissing(db, 'member', 'aliases', "TEXT DEFAULT '[]'")
        addColumnIfMissing(db, 'member', 'avatar', 'TEXT')
        addColumnIfMissing(db, 'member', 'roles', "TEXT DEFAULT '[]'")

        if (memberHadName) {
          db.exec("UPDATE member SET account_name = COALESCE(NULLIF(account_name, ''), name)")
        }
        if (memberHadNickname) {
          db.exec("UPDATE member SET group_nickname = COALESCE(NULLIF(group_nickname, ''), nickname)")
        }
        db.exec("UPDATE member SET aliases = COALESCE(aliases, '[]'), roles = COALESCE(roles, '[]')")

        db.exec(`
          CREATE TABLE IF NOT EXISTS member_name_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            member_id INTEGER NOT NULL,
            name_type TEXT DEFAULT 'account_name',
            name TEXT NOT NULL,
            start_ts INTEGER NOT NULL,
            end_ts INTEGER,
            FOREIGN KEY(member_id) REFERENCES member(id)
          )
        `)
        addColumnIfMissing(db, 'member_name_history', 'name_type', "TEXT DEFAULT 'account_name'")
        addColumnIfMissing(db, 'message', 'sender_account_name', 'TEXT')
        addColumnIfMissing(db, 'message', 'sender_group_nickname', 'TEXT')
        addColumnIfMissing(db, 'message', 'reply_to_message_id', 'TEXT DEFAULT NULL')
        addColumnIfMissing(db, 'message', 'platform_message_id', 'TEXT DEFAULT NULL')

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
        db.exec(`
          CREATE TABLE IF NOT EXISTS message_context (
            message_id INTEGER PRIMARY KEY,
            session_id INTEGER NOT NULL,
            topic_id INTEGER
          )
        `)

        db.exec('CREATE INDEX IF NOT EXISTS idx_message_platform_id ON message(platform_message_id)')
        db.exec('CREATE INDEX IF NOT EXISTS idx_member_name_history_member_id ON member_name_history(member_id)')
        db.exec('CREATE INDEX IF NOT EXISTS idx_session_time ON chat_session(start_ts, end_ts)')
        db.exec('CREATE INDEX IF NOT EXISTS idx_context_session ON message_context(session_id)')
      },
    },
  ]
}
