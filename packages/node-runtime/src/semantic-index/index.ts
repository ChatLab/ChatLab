/**
 * 语义索引模块（Phase 1）
 *
 * 独立于 dormant 的旧 `ai/rag` 模块，按 chunking-decision-final.md 重新实现：
 * 向量存储、parent/child chunker、embedding provider、混合召回与后台预热。
 */

export { EmbeddingIndexStore } from './store'
export type { LoadSqliteVec } from './store'
export {
  EMBEDDING_INDEX_SCHEMA,
  CHUNK_VECTOR_INDEX_TABLE,
  CHUNK_VECTOR_INDEX_INDEXES,
  SEMANTIC_INDEX_SESSION_TABLE,
  vecTableName,
  vecTableSchema,
} from './schema'
export { SemanticIndexStateStore } from './session-state-store'
export type {
  SemanticIndexSessionState,
  SemanticIndexStatus,
  SemanticIndexCleanupStatus,
  EnableParams,
  ProgressPatch,
} from './session-state-store'
export type {
  ChunkRecord,
  ChunkInsert,
  ChunkStatus,
  DenseQueryParams,
  DenseQueryResult,
  MessageToChunkParams,
} from './types'
export {
  CHUNKER_VERSION,
  STRATEGY_ID,
  DEFAULT_CHUNKER_CONFIG,
  computeChunkerConfigHash,
  computeDbPathHash,
  composeChunkId,
  deriveParentId,
  parseParentBounds,
} from './chunker-config'
export type { ChunkerConfig } from './chunker-config'
export { estimateTokens } from './tokens'
export {
  SemanticIndexConfigStore,
  defaultSemanticIndexConfig,
  resolveModelId,
  clampSearchMaxResults,
  SEMANTIC_INDEX_CONFIG_VERSION,
  SEARCH_MAX_RESULTS_DEFAULT,
  SEARCH_MAX_RESULTS_MIN,
  SEARCH_MAX_RESULTS_MAX,
} from './config'
export type {
  SemanticIndexConfig,
  SemanticIndexConfigInput,
  SemanticIndexMode,
  SemanticIndexLocalConfig,
  SemanticIndexApiConfig,
} from './config'
export { createEmbedder } from './embedder-factory'
export type { EmbedderFactoryDeps } from './embedder-factory'
export {
  SemanticIndexService,
  createSemanticIndexService,
  SEMANTIC_INDEX_DB_FILE,
  SEMANTIC_INDEX_CONFIG_FILE,
} from './service'
export type {
  SemanticIndexServiceOptions,
  SemanticIndexSessionStatus,
  SemanticSearchResult,
  SemanticSearchReason,
  SemanticSearchToolResult,
  SemanticSearchToolSource,
  SemanticSearchToolOptions,
} from './service'
export { runWarmup } from './warmup/runner'
export type {
  SemanticMessageSource,
  StopSignal,
  WarmupRunnerOptions,
  WarmupResult,
  WarmupStatus,
} from './warmup/runner'
export { SemanticIndexJobQueue } from './warmup/job-queue'
export type { SemanticIndexJob, SemanticIndexJobType, JobContext, JobExecutor } from './warmup/job-queue'
export { reciprocalRankFusion } from './retrieval/rrf'
export type { RrfResult } from './retrieval/rrf'
export { hybridSearch } from './retrieval/hybrid-search'
export type { FtsSearcher, HybridSearchDeps, HybridSearchParams, HybridSearchResult } from './retrieval/hybrid-search'
export { createChatDbMessageSource } from './chat-db/message-source'
export { createChatDbMessageRangeReader } from './chat-db/message-range-reader'
export { createChatDbFtsSearcher, extractFtsKeywords } from './chat-db/fts-searcher'
export { assembleEvidence, formatEvidenceMessages } from './retrieval/evidence'
export type {
  EvidenceMessage,
  MessageRangeReader,
  EvidenceHit,
  EvidenceBudget,
  EvidenceBlock,
  EvidenceResult,
} from './retrieval/evidence'
export { chunkMessages, isSemanticVoid } from './chunker'
export type { ChunkMessageInput, ChunkSource, ChunkMessagesInput, ChildChunk, ChunkResult } from './chunker'
export * as embedding from './embedding'
