/**
 * 语义索引业务状态存储（与向量库同一 embedding_index.db 文件）
 *
 * 保存对话级权威状态：是否启用、索引进度/状态、清理状态。后台任务队列只负责执行，
 * 启用与结果状态不从队列反推（见 chunking-decision-final.md 第 11.1/15 节）。
 * 以 db_path_hash 作为对话主键（一个聊天库 = 一个对话）。
 */

import Database from 'better-sqlite3'
import { SEMANTIC_INDEX_SESSION_TABLE } from './schema'

/** 索引生命周期状态 */
export type SemanticIndexStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

/** 清理生命周期状态 */
export type SemanticIndexCleanupStatus = 'none' | 'pending' | 'running' | 'done'

export interface SemanticIndexSessionState {
  dbPathHash: string
  dbPath: string
  enabled: boolean
  modelId: string | null
  indexStatus: SemanticIndexStatus
  cleanupStatus: SemanticIndexCleanupStatus
  totalMessages: number
  indexedMessages: number
  lastIndexedMessageId: number | null
  chunkCount: number
  /** 建立索引时使用的 chunker 算法版本（与当前不一致 => 需重建） */
  chunkerVersion: string | null
  /** 建立索引时使用的 chunker 参数 hash（与当前不一致 => 需重建） */
  chunkerConfigHash: string | null
  error: string | null
  enabledAt: number | null
  updatedAt: number
}

export interface EnableParams {
  dbPathHash: string
  dbPath: string
  modelId: string
  /** 当前 chunker 算法版本，随索引一起记录用于重建判断 */
  chunkerVersion: string
  /** 当前 chunker 参数 hash，随索引一起记录用于重建判断 */
  chunkerConfigHash: string
}

export interface ProgressPatch {
  indexStatus?: SemanticIndexStatus
  totalMessages?: number
  indexedMessages?: number
  lastIndexedMessageId?: number
  chunkCount?: number
  error?: string | null
}

interface SessionRow {
  db_path_hash: string
  db_path: string
  enabled: number
  model_id: string | null
  index_status: string
  cleanup_status: string
  total_messages: number
  indexed_messages: number
  last_indexed_message_id: number | null
  chunk_count: number
  chunker_version: string | null
  chunker_config_hash: string | null
  error: string | null
  enabled_at: number | null
  updated_at: number
}

function rowToState(row: SessionRow): SemanticIndexSessionState {
  return {
    dbPathHash: row.db_path_hash,
    dbPath: row.db_path,
    enabled: row.enabled === 1,
    modelId: row.model_id,
    indexStatus: row.index_status as SemanticIndexStatus,
    cleanupStatus: row.cleanup_status as SemanticIndexCleanupStatus,
    totalMessages: row.total_messages,
    indexedMessages: row.indexed_messages,
    lastIndexedMessageId: row.last_indexed_message_id,
    chunkCount: row.chunk_count,
    chunkerVersion: row.chunker_version ?? null,
    chunkerConfigHash: row.chunker_config_hash ?? null,
    error: row.error,
    enabledAt: row.enabled_at,
    updatedAt: row.updated_at,
  }
}

export class SemanticIndexStateStore {
  private db: Database.Database

  constructor(dbPath: string, options?: { nativeBinding?: string }) {
    this.db = new Database(dbPath, { nativeBinding: options?.nativeBinding })
    this.db.pragma('journal_mode = WAL')
    this.db.exec(SEMANTIC_INDEX_SESSION_TABLE)
    this.ensureChunkerColumns()
  }

  /** 兼容旧版本表结构：缺少 chunker 身份列时补齐（identity 为空 => 后续判定需重建） */
  private ensureChunkerColumns(): void {
    const columns = this.db.prepare(`PRAGMA table_info(semantic_index_session)`).all() as { name: string }[]
    const names = new Set(columns.map((c) => c.name))
    if (!names.has('chunker_version')) {
      this.db.exec(`ALTER TABLE semantic_index_session ADD COLUMN chunker_version TEXT`)
    }
    if (!names.has('chunker_config_hash')) {
      this.db.exec(`ALTER TABLE semantic_index_session ADD COLUMN chunker_config_hash TEXT`)
    }
  }

  /** 启用对话索引；已存在则更新模型并清除待清理标记（覆盖重新启用/换模型场景） */
  enable(params: EnableParams): void {
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO semantic_index_session
           (db_path_hash, db_path, enabled, model_id, index_status, cleanup_status,
            chunker_version, chunker_config_hash, enabled_at, updated_at)
         VALUES (@dbPathHash, @dbPath, 1, @modelId, 'idle', 'none',
            @chunkerVersion, @chunkerConfigHash, @now, @now)
         ON CONFLICT(db_path_hash) DO UPDATE SET
           db_path = excluded.db_path,
           enabled = 1,
           model_id = excluded.model_id,
           cleanup_status = 'none',
           chunker_version = excluded.chunker_version,
           chunker_config_hash = excluded.chunker_config_hash,
           enabled_at = COALESCE(semantic_index_session.enabled_at, excluded.enabled_at),
           updated_at = excluded.updated_at`
      )
      .run({
        dbPathHash: params.dbPathHash,
        dbPath: params.dbPath,
        modelId: params.modelId,
        chunkerVersion: params.chunkerVersion,
        chunkerConfigHash: params.chunkerConfigHash,
        now,
      })
  }

  /**
   * 重新激活已有状态行（stale 重建场景）：仅更新 enabled 和 dbPath，保留旧身份字段，
   * 使 buildAllPending() 重启后仍能通过 isStale() 检测到需重建并入队 rebuild。
   */
  reactivate(dbPathHash: string, dbPath: string): void {
    this.db
      .prepare(
        `UPDATE semantic_index_session SET enabled = 1, db_path = ?, cleanup_status = 'none', updated_at = ? WHERE db_path_hash = ?`
      )
      .run(dbPath, Date.now(), dbPathHash)
  }

  /** 停用对话索引；标记待清理，保留状态与已建索引直到清理任务执行 */
  disable(dbPathHash: string): void {
    this.db
      .prepare(
        `UPDATE semantic_index_session
         SET enabled = 0, cleanup_status = 'pending', updated_at = ?
         WHERE db_path_hash = ?`
      )
      .run(Date.now(), dbPathHash)
  }

  updateProgress(dbPathHash: string, patch: ProgressPatch): void {
    const sets: string[] = []
    const values: Record<string, unknown> = { dbPathHash, now: Date.now() }
    const map: Record<keyof ProgressPatch, string> = {
      indexStatus: 'index_status',
      totalMessages: 'total_messages',
      indexedMessages: 'indexed_messages',
      lastIndexedMessageId: 'last_indexed_message_id',
      chunkCount: 'chunk_count',
      error: 'error',
    }
    for (const key of Object.keys(map) as (keyof ProgressPatch)[]) {
      if (patch[key] !== undefined) {
        sets.push(`${map[key]} = @${key}`)
        values[key] = patch[key]
      }
    }
    if (sets.length === 0) return
    this.db
      .prepare(
        `UPDATE semantic_index_session SET ${sets.join(', ')}, updated_at = @now WHERE db_path_hash = @dbPathHash`
      )
      .run(values)
  }

  setIndexStatus(dbPathHash: string, status: SemanticIndexStatus, error?: string | null): void {
    this.db
      .prepare(`UPDATE semantic_index_session SET index_status = ?, error = ?, updated_at = ? WHERE db_path_hash = ?`)
      .run(status, error ?? null, Date.now(), dbPathHash)
  }

  setCleanupStatus(dbPathHash: string, status: SemanticIndexCleanupStatus): void {
    this.db
      .prepare(`UPDATE semantic_index_session SET cleanup_status = ?, updated_at = ? WHERE db_path_hash = ?`)
      .run(status, Date.now(), dbPathHash)
  }

  /**
   * 刷新索引身份（模型 + chunker version/config hash）。
   * rebuild 以当前配置重写向量后调用，确保完成后不再被判为需重建（stale -> rebuild 闭环）。
   */
  setBuildIdentity(
    dbPathHash: string,
    identity: { modelId: string; chunkerVersion: string; chunkerConfigHash: string }
  ): void {
    this.db
      .prepare(
        `UPDATE semantic_index_session
         SET model_id = ?, chunker_version = ?, chunker_config_hash = ?, updated_at = ?
         WHERE db_path_hash = ?`
      )
      .run(identity.modelId, identity.chunkerVersion, identity.chunkerConfigHash, Date.now(), dbPathHash)
  }

  /** 重置进度与状态到初始（rebuild 前调用，清空断点游标，避免续跑跳过） */
  resetProgress(dbPathHash: string): void {
    this.db
      .prepare(
        `UPDATE semantic_index_session
         SET index_status = 'idle', indexed_messages = 0, chunk_count = 0,
             last_indexed_message_id = NULL, error = NULL, updated_at = ?
         WHERE db_path_hash = ?`
      )
      .run(Date.now(), dbPathHash)
  }

  getState(dbPathHash: string): SemanticIndexSessionState | null {
    const row = this.db.prepare(`SELECT * FROM semantic_index_session WHERE db_path_hash = ?`).get(dbPathHash) as
      | SessionRow
      | undefined
    return row ? rowToState(row) : null
  }

  listEnabled(): SemanticIndexSessionState[] {
    const rows = this.db
      .prepare(`SELECT * FROM semantic_index_session WHERE enabled = 1 ORDER BY enabled_at`)
      .all() as SessionRow[]
    return rows.map(rowToState)
  }

  listAll(): SemanticIndexSessionState[] {
    const rows = this.db.prepare(`SELECT * FROM semantic_index_session ORDER BY enabled_at`).all() as SessionRow[]
    return rows.map(rowToState)
  }

  listPendingCleanup(): SemanticIndexSessionState[] {
    const rows = this.db
      .prepare(`SELECT * FROM semantic_index_session WHERE cleanup_status = 'pending' ORDER BY updated_at`)
      .all() as SessionRow[]
    return rows.map(rowToState)
  }

  remove(dbPathHash: string): number {
    return this.db.prepare(`DELETE FROM semantic_index_session WHERE db_path_hash = ?`).run(dbPathHash).changes
  }

  close(): void {
    this.db.close()
  }
}
