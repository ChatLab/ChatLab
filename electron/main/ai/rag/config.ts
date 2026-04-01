/**
 * RAG 配置管理
 * 支持多 Embedding 配置模式（参考 LLM 配置）
 */

import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import {
  DEFAULT_RAG_CONFIG,
  DEFAULT_EMBEDDING_CONFIG_STORE,
  MAX_EMBEDDING_CONFIG_COUNT,
  type RAGConfig,
  type EmbeddingServiceConfig,
  type EmbeddingConfigStore,
} from './types'
import { aiLogger as logger } from '../logger'
import { getAiDataDir } from '../../paths'

// ==================== 路径管理 ====================

/**
 * 获取 RAG 配置文件路径
 */
function getConfigPath(): string {
  return path.join(getAiDataDir(), 'rag-config.json')
}

/**
 * 获取 Embedding 配置文件路径
 */
function getEmbeddingConfigPath(): string {
  return path.join(getAiDataDir(), 'embedding-config.json')
}

/**
 * 获取向量存储目录
 */
export function getVectorStoreDir(): string {
  const dir = path.join(getAiDataDir(), 'vectors')

  // 确保目录存在
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  return dir
}

// ==================== Embedding 多配置管理 ====================

/**
 * 加载 Embedding 配置存储
 */
export function loadEmbeddingConfigStore(): EmbeddingConfigStore {
  const configPath = getEmbeddingConfigPath()

  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_EMBEDDING_CONFIG_STORE }
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8')
    const data = JSON.parse(content) as EmbeddingConfigStore

    // 确保有默认值
    return {
      configs: data.configs || [],
      activeConfigId: data.activeConfigId || null,
      enabled: data.enabled ?? false,
    }
  } catch (error) {
    logger.error('RAG', 'Failed to load Embedding configs', error)
    return { ...DEFAULT_EMBEDDING_CONFIG_STORE }
  }
}

/**
 * 保存 Embedding 配置存储
 */
export function saveEmbeddingConfigStore(store: EmbeddingConfigStore): void {
  const configPath = getEmbeddingConfigPath()
  const dir = path.dirname(configPath)

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(configPath, JSON.stringify(store, null, 2), 'utf-8')
  logger.info('RAG', 'Embedding configs saved')
}

/**
 * 获取所有 Embedding 配置
 */
export function getAllEmbeddingConfigs(): EmbeddingServiceConfig[] {
  return loadEmbeddingConfigStore().configs
}

/**
 * 获取当前激活的 Embedding 配置
 */
export function getActiveEmbeddingConfig(): EmbeddingServiceConfig | null {
  const store = loadEmbeddingConfigStore()
  if (!store.activeConfigId || !store.enabled) return null
  return store.configs.find((c) => c.id === store.activeConfigId) || null
}

/**
 * 获取单个 Embedding 配置
 */
export function getEmbeddingConfigById(id: string): EmbeddingServiceConfig | null {
  const store = loadEmbeddingConfigStore()
  return store.configs.find((c) => c.id === id) || null
}

/**
 * 添加新 Embedding 配置
 */
export function addEmbeddingConfig(config: Omit<EmbeddingServiceConfig, 'id' | 'createdAt' | 'updatedAt'>): {
  success: boolean
  config?: EmbeddingServiceConfig
  error?: string
} {
  const store = loadEmbeddingConfigStore()

  if (store.configs.length >= MAX_EMBEDDING_CONFIG_COUNT) {
    return { success: false, error: `最多只能添加 ${MAX_EMBEDDING_CONFIG_COUNT} 个配置` }
  }

  const now = Date.now()
  const newConfig: EmbeddingServiceConfig = {
    ...config,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
  }

  store.configs.push(newConfig)

  // 如果是第一个配置，自动设为激活
  if (store.configs.length === 1) {
    store.activeConfigId = newConfig.id
  }

  saveEmbeddingConfigStore(store)
  logger.info('RAG', `Adding Embedding config: ${newConfig.name}`)
  return { success: true, config: newConfig }
}

/**
 * 更新 Embedding 配置
 */
export function updateEmbeddingConfig(
  id: string,
  updates: Partial<Omit<EmbeddingServiceConfig, 'id' | 'createdAt' | 'updatedAt'>>
): { success: boolean; error?: string } {
  const store = loadEmbeddingConfigStore()
  const index = store.configs.findIndex((c) => c.id === id)

  if (index === -1) {
    return { success: false, error: '配置不存在' }
  }

  store.configs[index] = {
    ...store.configs[index],
    ...updates,
    updatedAt: Date.now(),
  }

  saveEmbeddingConfigStore(store)
  logger.info('RAG', `Updating Embedding config: ${store.configs[index].name}`)
  return { success: true }
}

/**
 * 删除 Embedding 配置
 */
export function deleteEmbeddingConfig(id: string): { success: boolean; error?: string } {
  const store = loadEmbeddingConfigStore()
  const index = store.configs.findIndex((c) => c.id === id)

  if (index === -1) {
    return { success: false, error: '配置不存在' }
  }

  const deletedName = store.configs[index].name
  store.configs.splice(index, 1)

  // 如果删除的是当前激活的配置，选择第一个作为新的激活配置
  if (store.activeConfigId === id) {
    store.activeConfigId = store.configs.length > 0 ? store.configs[0].id : null
  }

  saveEmbeddingConfigStore(store)
  logger.info('RAG', `Deleting Embedding config: ${deletedName}`)
  return { success: true }
}

/**
 * 设置激活的 Embedding 配置
 */
export function setActiveEmbeddingConfig(id: string): { success: boolean; error?: string } {
  const store = loadEmbeddingConfigStore()
  const config = store.configs.find((c) => c.id === id)

  if (!config) {
    return { success: false, error: '配置不存在' }
  }

  store.activeConfigId = id
  saveEmbeddingConfigStore(store)
  logger.info('RAG', `Activating Embedding config: ${config.name}`)
  return { success: true }
}

/**
 * 检查语义搜索是否启用
 * 简化逻辑：只要有激活的配置就启用
 */
export function isEmbeddingEnabled(): boolean {
  const store = loadEmbeddingConfigStore()
  // 只要有激活的配置就启用，无需额外开关
  return store.activeConfigId !== null && store.configs.some((c) => c.id === store.activeConfigId)
}

/**
 * 获取激活配置 ID
 */
export function getActiveEmbeddingConfigId(): string | null {
  return loadEmbeddingConfigStore().activeConfigId
}

// ==================== 旧版 RAG 配置（兼容） ====================

/**
 * 加载 RAG 配置
 */
export function loadRAGConfig(): RAGConfig {
  try {
    const configPath = getConfigPath()

    if (!fs.existsSync(configPath)) {
      return { ...DEFAULT_RAG_CONFIG }
    }

    const content = fs.readFileSync(configPath, 'utf-8')
    const config = JSON.parse(content) as RAGConfig

    // 合并默认配置，确保新字段有默认值
    return mergeConfig(DEFAULT_RAG_CONFIG, config)
  } catch (error) {
    logger.error('RAG', 'Failed to load configs', error)
    return { ...DEFAULT_RAG_CONFIG }
  }
}

/**
 * 保存 RAG 配置
 */
export function saveRAGConfig(config: RAGConfig): void {
  try {
    const configPath = getConfigPath()
    const dir = path.dirname(configPath)

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
    logger.info('RAG', 'Configs saved')
  } catch (error) {
    logger.error('RAG', 'Failed to save configs', error)
    throw error
  }
}

/**
 * 更新 RAG 配置（部分更新）
 */
export function updateRAGConfig(updates: Partial<RAGConfig>): RAGConfig {
  const current = loadRAGConfig()
  const updated = mergeConfig(current, updates)
  saveRAGConfig(updated)
  return updated
}

/**
 * 深度合并配置
 */
function mergeConfig<T extends object>(base: T, override: Partial<T>): T {
  const result = { ...base }

  for (const key in override) {
    if (Object.prototype.hasOwnProperty.call(override, key)) {
      const overrideValue = override[key]
      const baseValue = base[key]

      if (overrideValue !== undefined) {
        if (
          typeof overrideValue === 'object' &&
          overrideValue !== null &&
          !Array.isArray(overrideValue) &&
          typeof baseValue === 'object' &&
          baseValue !== null &&
          !Array.isArray(baseValue)
        ) {
          // 递归合并对象
          ;(result as Record<string, unknown>)[key] = mergeConfig(baseValue as object, overrideValue as object)
        } else {
          // 直接覆盖
          ;(result as Record<string, unknown>)[key] = overrideValue
        }
      }
    }
  }

  return result
}

/**
 * 重置 RAG 配置为默认值
 */
export function resetRAGConfig(): RAGConfig {
  const config = { ...DEFAULT_RAG_CONFIG }
  saveRAGConfig(config)
  return config
}
