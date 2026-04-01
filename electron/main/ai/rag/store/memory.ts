/**
 * 内存向量存储
 *
 * 使用 LRU 缓存，重启后数据丢失
 * 适用于不需要持久化的场景
 */

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
 * LRU 缓存节点
 */
interface CacheNode {
  id: string
  vector: number[]
  metadata?: Record<string, unknown>
  prev: CacheNode | null
  next: CacheNode | null
}

/**
 * 内存向量存储实现（LRU 缓存）
 */
export class MemoryVectorStore implements IVectorStore {
  private capacity: number
  private cache: Map<string, CacheNode> = new Map()
  private head: CacheNode | null = null // 最近使用
  private tail: CacheNode | null = null // 最久未使用

  constructor(capacity: number = 10000) {
    this.capacity = capacity
  }

  /**
   * 将节点移动到头部（标记为最近使用）
   */
  private moveToHead(node: CacheNode): void {
    if (node === this.head) return

    // 从原位置移除
    if (node.prev) {
      node.prev.next = node.next
    }
    if (node.next) {
      node.next.prev = node.prev
    }
    if (node === this.tail) {
      this.tail = node.prev
    }

    // 移动到头部
    node.prev = null
    node.next = this.head
    if (this.head) {
      this.head.prev = node
    }
    this.head = node

    if (!this.tail) {
      this.tail = node
    }
  }

  /**
   * 添加新节点到头部
   */
  private addToHead(node: CacheNode): void {
    node.prev = null
    node.next = this.head
    if (this.head) {
      this.head.prev = node
    }
    this.head = node

    if (!this.tail) {
      this.tail = node
    }
  }

  /**
   * 移除尾部节点（最久未使用）
   */
  private removeTail(): CacheNode | null {
    if (!this.tail) return null

    const removed = this.tail
    this.tail = removed.prev
    if (this.tail) {
      this.tail.next = null
    } else {
      this.head = null
    }

    return removed
  }

  /**
   * 添加向量
   */
  async add(id: string, vector: number[], metadata?: Record<string, unknown>): Promise<void> {
    if (this.cache.has(id)) {
      // 更新已有节点
      const node = this.cache.get(id)!
      node.vector = vector
      node.metadata = metadata
      this.moveToHead(node)
    } else {
      // 添加新节点
      const node: CacheNode = {
        id,
        vector,
        metadata,
        prev: null,
        next: null,
      }

      this.cache.set(id, node)
      this.addToHead(node)

      // 超出容量，移除最久未使用
      if (this.cache.size > this.capacity) {
        const removed = this.removeTail()
        if (removed) {
          this.cache.delete(removed.id)
        }
      }
    }
  }

  /**
   * 批量添加向量
   */
  async addBatch(items: Array<{ id: string; vector: number[]; metadata?: Record<string, unknown> }>): Promise<void> {
    for (const item of items) {
      await this.add(item.id, item.vector, item.metadata)
    }
  }

  /**
   * 获取向量
   */
  async get(id: string): Promise<number[] | null> {
    const node = this.cache.get(id)
    if (!node) return null

    this.moveToHead(node)
    return node.vector
  }

  /**
   * 检查是否存在
   */
  async has(id: string): Promise<boolean> {
    return this.cache.has(id)
  }

  /**
   * 删除向量
   */
  async delete(id: string): Promise<void> {
    const node = this.cache.get(id)
    if (!node) return

    // 从链表中移除
    if (node.prev) {
      node.prev.next = node.next
    }
    if (node.next) {
      node.next.prev = node.prev
    }
    if (node === this.head) {
      this.head = node.next
    }
    if (node === this.tail) {
      this.tail = node.prev
    }

    this.cache.delete(id)
  }

  /**
   * 相似度搜索
   */
  async search(query: number[], topK: number): Promise<VectorSearchResult[]> {
    const results: VectorSearchResult[] = []

    for (const node of this.cache.values()) {
      const score = cosineSimilarity(query, node.vector)
      results.push({
        id: node.id,
        score,
        metadata: node.metadata,
      })
    }

    // 排序取 topK
    results.sort((a, b) => b.score - a.score)
    return results.slice(0, topK)
  }

  /**
   * 清空存储
   */
  async clear(): Promise<void> {
    this.cache.clear()
    this.head = null
    this.tail = null
    logger.info('Memory Store', 'All vectors cleared')
  }

  /**
   * 获取存储统计
   */
  async getStats(): Promise<VectorStoreStats> {
    // 获取第一个向量的维度
    let dimensions: number | undefined
    for (const node of this.cache.values()) {
      dimensions = node.vector.length
      break
    }

    // 估算内存占用（粗略计算）
    let sizeBytes: number | undefined
    if (dimensions) {
      // 每个向量占用 dimensions * 4 bytes (Float32)
      // 加上 id、metadata 等开销，估算为 dimensions * 8
      sizeBytes = this.cache.size * dimensions * 8
    }

    return {
      count: this.cache.size,
      dimensions,
      sizeBytes,
    }
  }

  /**
   * 关闭存储
   */
  async close(): Promise<void> {
    // 内存存储无需关闭操作
    logger.info('Memory Store', 'Closed')
  }
}
