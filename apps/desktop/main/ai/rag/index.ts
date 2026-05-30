/**
 * RAG module — Electron thin wrapper
 *
 * Delegates all logic to @openchatlab/node-runtime.
 * Provides Electron-specific path / logger / LLM config injection.
 */

import { initRag, type RagLogger } from '@openchatlab/node-runtime'
import { aiLogger } from '../logger'
import { getPathProvider } from '../../path-context'
import { getDefaultAssistantConfig } from '../llm'

let _initialized = false

function ensureInit(): void {
  if (_initialized) return
  _initialized = true

  const logger: RagLogger = {
    info: (category, message, data) => aiLogger.info(category, message, data),
    warn: (category, message, data) => aiLogger.warn(category, message, data),
    error: (category, message, data) => aiLogger.error(category, message, data),
  }

  initRag({
    aiDataDir: getPathProvider().getAiDataDir(),
    logger,
    getLLMConfig: () => {
      const cfg = getDefaultAssistantConfig()
      if (!cfg) return null
      return {
        provider: cfg.provider,
        apiKey: cfg.apiKey || undefined,
        baseUrl: cfg.baseUrl,
      }
    },
    getAssistantConfig: () => {
      const cfg = getDefaultAssistantConfig()
      if (!cfg) return null
      return {
        provider: cfg.provider,
        model: cfg.model,
        baseUrl: cfg.baseUrl,
        maxTokens: cfg.maxTokens,
        apiFormat: cfg.apiFormat,
        apiKey: cfg.apiKey || undefined,
      }
    },
  })
}

// ==================== Config management ====================

export {
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
  loadRAGConfig,
  saveRAGConfig,
  updateRAGConfig,
  resetRAGConfig,
  getVectorStoreDir,
} from '@openchatlab/node-runtime'

// ==================== Types ====================

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
} from '@openchatlab/node-runtime'

export {
  DEFAULT_RAG_CONFIG,
  DEFAULT_EMBEDDING_CONFIG_STORE,
  MAX_EMBEDDING_CONFIG_COUNT,
} from '@openchatlab/node-runtime'

// ==================== Embedding service ====================

export { getEmbeddingService, resetEmbeddingService, validateEmbeddingConfig } from '@openchatlab/node-runtime'

// ==================== Chunking ====================

export { getSessionChunks, getSessionChunk, formatSessionChunk } from '@openchatlab/node-runtime'

export type { ChunkingOptions, SessionMessage, SessionInfo } from '@openchatlab/node-runtime'

// ==================== Vector store ====================

export {
  getVectorStore,
  resetVectorStore,
  getVectorStoreStats,
  SQLiteVectorStore,
  MemoryVectorStore,
} from '@openchatlab/node-runtime'

// ==================== Pipeline ====================

export { executeSemanticPipeline } from '@openchatlab/node-runtime'

// ==================== Init hook ====================

export { ensureInit as ensureRagInit }
