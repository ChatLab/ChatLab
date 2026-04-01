/**
 * 向量存储管理器
 */

import * as path from 'path'
import type { IVectorStore, VectorStoreConfig } from './types'
import { SQLiteVectorStore } from './sqlite'
import { MemoryVectorStore } from './memory'
import { getVectorStoreDir, loadRAGConfig } from '../config'
import { aiLogger as logger } from '../../logger'

// 当前活动的向量存储实例
let activeStore: IVectorStore | null = null

/**
 * 获取向量存储
 * 根据配置自动选择存储类型
 */
export async function getVectorStore(): Promise<IVectorStore | null> {
  const config = loadRAGConfig()

  if (!config.vectorStore?.enabled) {
    return null
  }

  // 如果已有存储实例，直接返回
  if (activeStore) {
    return activeStore
  }

  try {
    activeStore = await createVectorStore(config.vectorStore)
    return activeStore
  } catch (error) {
    logger.error('Store Manager', 'Failed to create store', error)
    return null
  }
}

/**
 * 创建向量存储实例
 */
async function createVectorStore(config: VectorStoreConfig): Promise<IVectorStore> {
  switch (config.type) {
    case 'memory': {
      const capacity = config.memoryCacheSize || 10000
      logger.info('Store Manager', `Using memory store, capacity: ${capacity}`)
      return new MemoryVectorStore(capacity)
    }

    case 'sqlite': {
      const dbPath = config.dbPath || path.join(getVectorStoreDir(), 'embeddings.db')
      logger.info('Store Manager', `Using SQLite store: ${dbPath}`)
      return new SQLiteVectorStore(dbPath)
    }

    case 'lancedb': {
      // TODO: 实现 LanceDB 存储
      throw new Error('LanceDB 存储尚未实现')
    }

    default:
      throw new Error(`未知的存储类型: ${config.type}`)
  }
}

/**
 * 重置向量存储
 * 配置变更后调用
 */
export async function resetVectorStore(): Promise<void> {
  if (activeStore) {
    await activeStore.close()
    activeStore = null
    logger.info('Store Manager', 'Store reset')
  }
}

/**
 * 获取存储统计信息
 */
export async function getVectorStoreStats(): Promise<{
  enabled: boolean
  type?: string
  count?: number
  dimensions?: number
  sizeBytes?: number
}> {
  const config = loadRAGConfig()

  if (!config.vectorStore?.enabled) {
    return { enabled: false }
  }

  const store = await getVectorStore()
  if (!store) {
    return { enabled: true, type: config.vectorStore.type }
  }

  const stats = await store.getStats()
  return {
    enabled: true,
    type: config.vectorStore.type,
    ...stats,
  }
}

// 重导出
export { SQLiteVectorStore } from './sqlite'
export { MemoryVectorStore } from './memory'
export type { IVectorStore, VectorSearchResult, VectorStoreStats, VectorStoreConfig } from './types'
