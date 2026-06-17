/**
 * 语义索引向量存储（sqlite-vec vec0 + better-sqlite3）
 *
 * embedding_index.db 是独立系统级向量库。本存储负责：
 * - 初始化元数据表与按维度的 vec0 表。
 * - 写入 chunk 元数据与向量（同一事务，rowid 关联）。
 * - dense ANN 查询（限定 db_path_hash + model_id 分区）。
 * - FTS message_id -> chunk 的 O(log n) 范围映射。
 *
 * P0-1 硬约定：vec0 的 INTEGER 列与 k 参数绑定必须使用 CAST(? AS INTEGER)。
 */

import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import type {
  ChunkInsert,
  ChunkRecord,
  ChunkStatus,
  DenseQueryParams,
  DenseQueryResult,
  MessageToChunkParams,
} from './types'
import { EMBEDDING_INDEX_SCHEMA, vecTableName, vecTableSchema } from './schema'

/** 加载 sqlite-vec 扩展。Electron 打包后可注入自定义实现处理 asar 解包路径。 */
export type LoadSqliteVec = (db: Database.Database) => void

const defaultLoadSqliteVec: LoadSqliteVec = (db) => sqliteVec.load(db)

interface ChunkRow {
  chunk_id: string
  db_path_hash: string
  strategy_id: string
  model_id: string
  dim: number
  parent_id: string
  start_message_id: number
  end_message_id: number
  start_ts: number
  end_ts: number
  message_count: number
  raw_content_hash: string
  embedding_input_hash: string
  chunker_version: string
  chunker_config_hash: string
  indexed_at: number
  status: string
}

function rowToRecord(row: ChunkRow): ChunkRecord {
  return {
    chunkId: row.chunk_id,
    dbPathHash: row.db_path_hash,
    strategyId: row.strategy_id,
    modelId: row.model_id,
    dim: row.dim,
    parentId: row.parent_id,
    startMessageId: row.start_message_id,
    endMessageId: row.end_message_id,
    startTs: row.start_ts,
    endTs: row.end_ts,
    messageCount: row.message_count,
    rawContentHash: row.raw_content_hash,
    embeddingInputHash: row.embedding_input_hash,
    chunkerVersion: row.chunker_version,
    chunkerConfigHash: row.chunker_config_hash,
    indexedAt: row.indexed_at,
    status: row.status as ChunkStatus,
  }
}

function toFloat32Buffer(embedding: Float32Array | number[]): Buffer {
  const arr = embedding instanceof Float32Array ? embedding : new Float32Array(embedding)
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)
}

const CHUNK_COLUMN_LIST = [
  'chunk_id',
  'db_path_hash',
  'strategy_id',
  'model_id',
  'dim',
  'parent_id',
  'start_message_id',
  'end_message_id',
  'start_ts',
  'end_ts',
  'message_count',
  'raw_content_hash',
  'embedding_input_hash',
  'chunker_version',
  'chunker_config_hash',
  'indexed_at',
  'status',
] as const

const CHUNK_COLUMNS = CHUNK_COLUMN_LIST.join(', ')
const CHUNK_COLUMNS_PREFIXED = CHUNK_COLUMN_LIST.map((c) => `m.${c}`).join(', ')

export class EmbeddingIndexStore {
  private db: Database.Database
  private ensuredVecDims = new Set<number>()

  constructor(dbPath: string, options?: { loadSqliteVec?: LoadSqliteVec; readonly?: boolean; nativeBinding?: string }) {
    this.db = new Database(dbPath, { readonly: options?.readonly ?? false, nativeBinding: options?.nativeBinding })
    ;(options?.loadSqliteVec ?? defaultLoadSqliteVec)(this.db)
    if (!options?.readonly) {
      this.db.pragma('journal_mode = WAL')
      this.db.exec(EMBEDDING_INDEX_SCHEMA)
    }
  }

  /** 确保对应维度的 vec0 表已创建（懒加载） */
  private ensureVecTable(dim: number): void {
    if (this.ensuredVecDims.has(dim)) return
    this.db.exec(vecTableSchema(dim))
    this.ensuredVecDims.add(dim)
  }

  private insertOne(item: ChunkInsert): void {
    const { record, embedding } = item
    if (embedding.length !== record.dim) {
      throw new Error(`embedding length ${embedding.length} mismatches dim ${record.dim} for chunk ${record.chunkId}`)
    }
    this.ensureVecTable(record.dim)

    const meta = this.db
      .prepare(
        `INSERT INTO chunk_vector_index (${CHUNK_COLUMNS})
         VALUES (@chunkId, @dbPathHash, @strategyId, @modelId, @dim, @parentId, @startMessageId, @endMessageId,
                 @startTs, @endTs, @messageCount, @rawContentHash, @embeddingInputHash, @chunkerVersion,
                 @chunkerConfigHash, @indexedAt, @status)`
      )
      .run({
        chunkId: record.chunkId,
        dbPathHash: record.dbPathHash,
        strategyId: record.strategyId,
        modelId: record.modelId,
        dim: record.dim,
        parentId: record.parentId,
        startMessageId: record.startMessageId,
        endMessageId: record.endMessageId,
        startTs: record.startTs,
        endTs: record.endTs,
        messageCount: record.messageCount,
        rawContentHash: record.rawContentHash,
        embeddingInputHash: record.embeddingInputHash,
        chunkerVersion: record.chunkerVersion,
        chunkerConfigHash: record.chunkerConfigHash,
        indexedAt: record.indexedAt,
        status: record.status,
      })

    this.db
      .prepare(
        `INSERT INTO ${vecTableName(record.dim)} (vector_id, db_path_hash, model_id, embedding)
         VALUES (CAST(? AS INTEGER), ?, ?, ?)`
      )
      .run(Number(meta.lastInsertRowid), record.dbPathHash, record.modelId, toFloat32Buffer(embedding))
  }

  /** 写入单个 chunk（元数据 + 向量，同一事务） */
  insertChunk(record: ChunkRecord, embedding: Float32Array | number[]): void {
    this.db.transaction(() => this.insertOne({ record, embedding }))()
  }

  /** 批量写入 chunk（单事务） */
  insertChunks(items: ChunkInsert[]): void {
    this.db.transaction(() => {
      for (const item of items) this.insertOne(item)
    })()
  }

  /** dense ANN 查询，限定 db_path_hash + model_id 分区，cosine 距离升序 */
  queryDense(params: DenseQueryParams): DenseQueryResult[] {
    const table = vecTableName(params.dim)
    if (!this.tableExists(table)) return []

    const rows = this.db
      .prepare(
        `SELECT v.distance AS distance, ${CHUNK_COLUMNS_PREFIXED}
         FROM ${table} v
         JOIN chunk_vector_index m ON m.rowid = v.vector_id
         WHERE v.embedding MATCH ? AND v.db_path_hash = ? AND v.model_id = ? AND v.k = CAST(? AS INTEGER)
         ORDER BY v.distance`
      )
      .all(toFloat32Buffer(params.embedding), params.dbPathHash, params.modelId, params.k) as Array<
      ChunkRow & { distance: number }
    >

    return rows.map((row) => ({ chunkId: row.chunk_id, distance: row.distance, record: rowToRecord(row) }))
  }

  /**
   * FTS message_id -> chunk 映射。利用 chunk 非重叠连续特性，取 start <= messageId
   * 的最大 start，再校验 end 覆盖，O(log n)。
   */
  mapMessageToChunk(params: MessageToChunkParams): ChunkRecord | null {
    const row = this.db
      .prepare(
        `SELECT ${CHUNK_COLUMNS} FROM chunk_vector_index
         WHERE db_path_hash = ? AND model_id = ? AND strategy_id = ?
           AND start_message_id <= CAST(? AS INTEGER)
         ORDER BY start_message_id DESC LIMIT 1`
      )
      .get(params.dbPathHash, params.modelId, params.strategyId, params.messageId) as ChunkRow | undefined

    if (!row || row.end_message_id < params.messageId) return null
    return rowToRecord(row)
  }

  /** 删除某聊天库（全模型）的所有 chunk 元数据与向量，返回删除的元数据行数 */
  deleteByDbPathHash(dbPathHash: string): number {
    return this.db.transaction(() => {
      const rows = this.db
        .prepare('SELECT rowid AS rowid, dim FROM chunk_vector_index WHERE db_path_hash = ?')
        .all(dbPathHash) as Array<{ rowid: number; dim: number }>

      const delStmts = new Map<number, Database.Statement>()
      for (const { rowid, dim } of rows) {
        const table = vecTableName(dim)
        if (!this.tableExists(table)) continue
        let stmt = delStmts.get(dim)
        if (!stmt) {
          stmt = this.db.prepare(`DELETE FROM ${table} WHERE vector_id = CAST(? AS INTEGER)`)
          delStmts.set(dim, stmt)
        }
        stmt.run(rowid)
      }

      const res = this.db.prepare('DELETE FROM chunk_vector_index WHERE db_path_hash = ?').run(dbPathHash)
      return res.changes
    })()
  }

  /** 列出存储中存在 chunk 的所有 db_path_hash */
  listDbPathHashes(): string[] {
    const rows = this.db.prepare('SELECT DISTINCT db_path_hash FROM chunk_vector_index').all() as Array<{
      db_path_hash: string
    }>
    return rows.map((r) => r.db_path_hash)
  }

  /** 统计某聊天库 chunk 数（可选限定 model_id） */
  countChunks(dbPathHash: string, modelId?: string): number {
    const row = modelId
      ? (this.db
          .prepare('SELECT COUNT(*) AS c FROM chunk_vector_index WHERE db_path_hash = ? AND model_id = ?')
          .get(dbPathHash, modelId) as { c: number })
      : (this.db.prepare('SELECT COUNT(*) AS c FROM chunk_vector_index WHERE db_path_hash = ?').get(dbPathHash) as {
          c: number
        })
    return row.c
  }

  /** 取某聊天库 + 模型已写入 chunk 的维度（用于检索选表）；无 chunk 返回 null */
  getDim(dbPathHash: string, modelId: string): number | null {
    const row = this.db
      .prepare('SELECT dim FROM chunk_vector_index WHERE db_path_hash = ? AND model_id = ? LIMIT 1')
      .get(dbPathHash, modelId) as { dim: number } | undefined
    return row ? row.dim : null
  }

  /** 按 chunk_id 取元数据 */
  getChunkById(chunkId: string): ChunkRecord | null {
    const row = this.db.prepare(`SELECT ${CHUNK_COLUMNS} FROM chunk_vector_index WHERE chunk_id = ?`).get(chunkId) as
      | ChunkRow
      | undefined
    return row ? rowToRecord(row) : null
  }

  private tableExists(name: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM sqlite_master WHERE name = ?`).get(name)
  }

  close(): void {
    this.db.close()
  }
}
