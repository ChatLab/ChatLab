/**
 * ChatLab 聊天会话数据库 Schema 定义
 *
 * 所有 CREATE TABLE / INDEX 语句的单一事实来源。
 * 新建数据库时使用完整 Schema，现有数据库通过迁移脚本演进。
 *
 * 当前 Schema 版本：5
 */

/** 当前 Schema 版本（最新迁移的版本号） */
export const CURRENT_SCHEMA_VERSION = 5

/**
 * Table DDL only (no indexes). Used by bulk-import workflows that defer
 * index creation until after data is loaded for better write performance.
 */
export const CHAT_DB_TABLES = `
  CREATE TABLE IF NOT EXISTS meta (
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    type TEXT NOT NULL,
    imported_at INTEGER NOT NULL,
    group_id TEXT,
    group_avatar TEXT,
    owner_id TEXT,
    schema_version INTEGER DEFAULT ${CURRENT_SCHEMA_VERSION},
    session_gap_threshold INTEGER
  );

  CREATE TABLE IF NOT EXISTS member (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform_id TEXT NOT NULL UNIQUE,
    account_name TEXT,
    group_nickname TEXT,
    aliases TEXT DEFAULT '[]',
    avatar TEXT,
    roles TEXT DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS member_name_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    name_type TEXT NOT NULL,
    name TEXT NOT NULL,
    start_ts INTEGER NOT NULL,
    end_ts INTEGER,
    FOREIGN KEY(member_id) REFERENCES member(id)
  );

  CREATE TABLE IF NOT EXISTS message (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    sender_account_name TEXT,
    sender_group_nickname TEXT,
    ts INTEGER NOT NULL,
    type INTEGER NOT NULL,
    content TEXT,
    reply_to_message_id TEXT DEFAULT NULL,
    platform_message_id TEXT DEFAULT NULL,
    FOREIGN KEY(sender_id) REFERENCES member(id)
  );

  CREATE TABLE IF NOT EXISTS chat_session (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_ts INTEGER NOT NULL,
    end_ts INTEGER NOT NULL,
    message_count INTEGER DEFAULT 0,
    is_manual INTEGER DEFAULT 0,
    summary TEXT
  );

  CREATE TABLE IF NOT EXISTS message_context (
    message_id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL,
    topic_id INTEGER
  );
`

/**
 * Index DDL only. Applied after bulk import or as part of full schema init.
 */
export const CHAT_DB_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_message_ts ON message(ts);
  CREATE INDEX IF NOT EXISTS idx_message_sender ON message(sender_id);
  CREATE INDEX IF NOT EXISTS idx_message_platform_id ON message(platform_message_id);
  CREATE INDEX IF NOT EXISTS idx_member_name_history_member_id ON member_name_history(member_id);
  CREATE INDEX IF NOT EXISTS idx_session_time ON chat_session(start_ts, end_ts);
  CREATE INDEX IF NOT EXISTS idx_context_session ON message_context(session_id);
`

/**
 * Combined tables + indexes DDL (Schema Version 4).
 * For new database creation where deferred indexing is not needed.
 */
export const CHAT_DB_SCHEMA = CHAT_DB_TABLES + CHAT_DB_INDEXES

/**
 * FTS5 全文搜索虚拟表 DDL
 *
 * content='' 表示使用外部内容表模式（不存储原始内容，只存储索引）。
 * 填充需要在导入或迁移时手动执行。
 */
export const FTS_TABLE_SCHEMA = `
  CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
    content,
    content='',
    content_rowid=id
  );
`
