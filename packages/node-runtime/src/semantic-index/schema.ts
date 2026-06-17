/**
 * embedding_index.db schema 定义（单一事实来源）
 *
 * 结构：
 * - chunk_vector_index：dim 无关的元数据普通表，rowid 关联 vec0 向量。
 * - chunk_vec_{dim}：每个 embedding 维度一张 vec0 虚拟表（vec0 要求列内维度固定）。
 *   PARTITION KEY 同时包含 db_path_hash 和 model_id，保证查询命中分区裁剪、隔离
 *   模型切换/重建期的新旧向量。详见 chunking-decision-final.md 第 11.1/17 节。
 */

/** 元数据表（dim 无关），rowid 即对应 vec0 的 vector_id */
export const CHUNK_VECTOR_INDEX_TABLE = `
  CREATE TABLE IF NOT EXISTS chunk_vector_index (
    rowid INTEGER PRIMARY KEY,
    chunk_id TEXT NOT NULL UNIQUE,
    db_path_hash TEXT NOT NULL,
    strategy_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    dim INTEGER NOT NULL,
    parent_id TEXT NOT NULL,
    start_message_id INTEGER NOT NULL,
    end_message_id INTEGER NOT NULL,
    start_ts INTEGER NOT NULL,
    end_ts INTEGER NOT NULL,
    message_count INTEGER NOT NULL,
    raw_content_hash TEXT NOT NULL,
    embedding_input_hash TEXT NOT NULL,
    chunker_version TEXT NOT NULL,
    chunker_config_hash TEXT NOT NULL,
    indexed_at INTEGER NOT NULL,
    status TEXT NOT NULL
  );
`

/**
 * 范围映射索引：FTS message_id -> chunk 的 O(log n) 查询依赖前导列顺序，
 * 配合 `start_message_id <= ? ORDER BY start_message_id DESC LIMIT 1`。
 */
export const CHUNK_VECTOR_INDEX_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_chunk_range
    ON chunk_vector_index(db_path_hash, model_id, strategy_id, start_message_id, end_message_id);
`

export const EMBEDDING_INDEX_SCHEMA = CHUNK_VECTOR_INDEX_TABLE + CHUNK_VECTOR_INDEX_INDEXES

/**
 * 语义索引业务状态表（与向量表同库）。
 *
 * 保存"对话是否启用索引"、索引进度/状态与清理状态。这些状态是权威来源，
 * 不能从后台任务队列反推（见 chunking-decision-final.md 第 11.1/15 节）。
 * 以 db_path_hash 作为对话主键（一个聊天库 = 一个对话）。
 */
export const SEMANTIC_INDEX_SESSION_TABLE = `
  CREATE TABLE IF NOT EXISTS semantic_index_session (
    db_path_hash TEXT PRIMARY KEY,
    db_path TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    model_id TEXT,
    index_status TEXT NOT NULL DEFAULT 'idle',
    cleanup_status TEXT NOT NULL DEFAULT 'none',
    total_messages INTEGER NOT NULL DEFAULT 0,
    indexed_messages INTEGER NOT NULL DEFAULT 0,
    last_indexed_message_id INTEGER,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    chunker_version TEXT,
    chunker_config_hash TEXT,
    error TEXT,
    enabled_at INTEGER,
    updated_at INTEGER NOT NULL
  );
`

/** 给定维度的 vec0 表名 */
export function vecTableName(dim: number): string {
  return `chunk_vec_${dim}`
}

/** 给定维度的 vec0 虚拟表 DDL */
export function vecTableSchema(dim: number): string {
  return `
    CREATE VIRTUAL TABLE IF NOT EXISTS ${vecTableName(dim)} USING vec0(
      vector_id INTEGER PRIMARY KEY,
      db_path_hash TEXT PARTITION KEY,
      model_id TEXT PARTITION KEY,
      embedding FLOAT[${dim}] distance_metric=cosine
    );
  `
}
