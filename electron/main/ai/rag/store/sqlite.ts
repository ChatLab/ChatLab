/**
 * SQLite 向量存储（BLOB 格式）
 *
 * 使用 BLOB 存储 Float32Array buffer，而不是 JSON 字符串
 * 优点：体积小（约 50%）、读取快（无需 JSON.parse）
 */

import Database from 'better-sqlite3'
import type { IVectorStore, VectorSearchResult, VectorStoreStats } from './types'
import { aiLogger as logger } from '../../logger'

/**
 * 余弦相似度计算
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  const len = Math.min(a.length, b.length)

  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-12)
}

/**
 * 将数字数组转换为 Buffer（Float32Array）
 */
function vectorToBuffer(vector: number[]): Buffer {
  const float32 = new Float32Array(vector)
  return Buffer.from(float32.buffer)
}

/**
 * 将 Buffer 转换为数字数组
 */
function bufferToVector(buffer: Buffer): number[] {
  const float32 = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4)
  return Array.from(float32)
}

/**
 * SQLite 向量存储实现
 */
export class SQLiteVectorStore implements IVectorStore {
  private db: Database.Database
  private dbPath: string

  constructor(dbPath: string) {
    this.dbPath = dbPath
    this.db = new Database(dbPath)
    this.initSchema()
  }

  /**
   * 初始化数据库 Schema
   */
  private initSchema(): void {
    this.db.pragma('journal_mode = WAL')

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id TEXT PRIMARY KEY,
        vector BLOB NOT NULL,
        dimensions INTEGER NOT NULL,
        metadata TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      )
    `)

    // 创建索引
    try {
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_vectors_created ON vectors(created_at)')
    } catch {
      // 索引可能已存在
    }

    logger.info('SQLite Store', `Initialized: ${this.dbPath}`)
  }

  /**
   * 添加向量（Float32Array → BLOB）
   */
  async add(id: string, vector: number[], metadata?: Record<string, unknown>): Promise<void> {
    const buffer = vectorToBuffer(vector)

    this.db
      .prepare(
        `
      INSERT OR REPLACE INTO vectors (id, vector, dimensions, metadata)
      VALUES (?, ?, ?, ?)
    `
      )
      .run(id, buffer, vector.length, metadata ? JSON.stringify(metadata) : null)
  }

  /**
   * 批量添加向量
   */
  async addBatch(items: Array<{ id: string; vector: number[]; metadata?: Record<string, unknown> }>): Promise<void> {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO vectors (id, vector, dimensions, metadata)
      VALUES (?, ?, ?, ?)
    `)

    type VectorBatchItem = { id: string; vector: number[]; metadata?: Record<string, unknown> }
    const insertMany = this.db.transaction((batchItems: VectorBatchItem[]) => {
      for (const item of batchItems) {
        const buffer = vectorToBuffer(item.vector)
        insert.run(item.id, buffer, item.vector.length, item.metadata ? JSON.stringify(item.metadata) : null)
      }
    })

    insertMany(items)
  }

  /**
   * 获取向量（BLOB → Float32Array）
   */
  async get(id: string): Promise<number[] | null> {
    const row = this.db.prepare('SELECT vector FROM vectors WHERE id = ?').get(id) as { vector: Buffer } | undefined

    if (!row) return null

    return bufferToVector(row.vector)
  }

  /**
   * 检查是否存在
   */
  async has(id: string): Promise<boolean> {
    const row = this.db.prepare('SELECT 1 FROM vectors WHERE id = ?').get(id)
    return !!row
  }

  /**
   * 删除向量
   */
  async delete(id: string): Promise<void> {
    this.db.prepare('DELETE FROM vectors WHERE id = ?').run(id)
  }

  /**
   * 相似度搜索
   * 注意：SQLite 不支持向量索引，需要全量加载到内存计算
   */
  async search(query: number[], topK: number): Promise<VectorSearchResult[]> {
    // 1. 全量读取（仅读取 id 和 vector）
    const rows = this.db.prepare('SELECT id, vector, metadata FROM vectors').all() as Array<{
      id: string
      vector: Buffer
      metadata: string | null
    }>

    if (rows.length === 0) {
      return []
    }

    // 2. 计算余弦相似度并排序
    const results: VectorSearchResult[] = rows.map((row) => {
      const vector = bufferToVector(row.vector)
      const score = cosineSimilarity(query, vector)
      return {
        id: row.id,
        score,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      }
    })

    // 3. 排序取 topK
    results.sort((a, b) => b.score - a.score)
    return results.slice(0, topK)
  }

  /**
   * 清空存储
   */
  async clear(): Promise<void> {
    this.db.exec('DELETE FROM vectors')
    logger.info('SQLite Store', 'All vectors cleared')
  }

  /**
   * 获取存储统计
   */
  async getStats(): Promise<VectorStoreStats> {
    const countRow = this.db.prepare('SELECT COUNT(*) as count FROM vectors').get() as { count: number }

    // 获取第一个向量的维度
    const dimRow = this.db.prepare('SELECT dimensions FROM vectors LIMIT 1').get() as { dimensions: number } | undefined

    // 获取数据库文件大小
    let sizeBytes: number | undefined
    try {
      const fs = await import('fs')
      const stats = fs.statSync(this.dbPath)
      sizeBytes = stats.size
    } catch {
      // 忽略错误
    }

    return {
      count: countRow.count,
      dimensions: dimRow?.dimensions,
      sizeBytes,
    }
  }

  /**
   * 关闭存储
   */
  async close(): Promise<void> {
    this.db.close()
    logger.info('SQLite Store', 'Closed')
  }
}
