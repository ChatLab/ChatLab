/**
 * RAG 模块主入口
 *
 * 提供 RAG（检索增强生成）功能：
 * - Embedding 服务（API 方式，多配置模式）
 * - 会话级切片
 * - 向量存储（SQLite BLOB + 内存 LRU）
 * - Semantic Pipeline
 */

// ==================== 配置管理 ====================

export {
  // 新版多配置管理
  loadEmbeddingConfigStore,
  saveEmbeddingConfigStore,
  getAllEmbeddingConfigs,
  getActiveEmbeddingConfig,
  getEmbeddingConfigById,
  addEmbeddingConfig,
  updateEmbeddingConfig,
  deleteEmbeddingConfig,
  setActiveEmbeddingConfig,
  isEmbeddingEnabled,
  getActiveEmbeddingConfigId,
  // 旧版兼容
  loadRAGConfig,
  saveRAGConfig,
  updateRAGConfig,
  resetRAGConfig,
  getVectorStoreDir,
} from './config'

// ==================== 类型定义 ====================

export type {
  RAGConfig,
  EmbeddingConfig,
  EmbeddingServiceConfig,
  EmbeddingConfigStore,
  VectorStoreConfig,
  RerankConfig,
  IEmbeddingService,
  IVectorStore,
  IRerankService,
  Chunk,
  ChunkMetadata,
  VectorSearchResult,
  VectorStoreStats,
  SemanticPipelineOptions,
  SemanticPipelineResult,
} from './types'

export { DEFAULT_RAG_CONFIG, DEFAULT_EMBEDDING_CONFIG_STORE, MAX_EMBEDDING_CONFIG_COUNT } from './types'

// ==================== Embedding 服务 ====================

export { getEmbeddingService, resetEmbeddingService, validateEmbeddingConfig } from './embedding'

// ==================== 切片服务 ====================

export { getSessionChunks, getSessionChunk, formatSessionChunk } from './chunking'
export type { ChunkingOptions, SessionMessage, SessionInfo } from './chunking'

// ==================== 向量存储 ====================

export { getVectorStore, resetVectorStore, getVectorStoreStats, SQLiteVectorStore, MemoryVectorStore } from './store'

// ==================== Pipeline ====================

export { executeSemanticPipeline } from './pipeline'
