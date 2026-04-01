/**
 * RAG 模块类型定义
 */

// ==================== Embedding 服务配置（多配置模式） ====================

/**
 * 单个 Embedding 服务配置
 */
export interface EmbeddingServiceConfig {
  /** 配置 ID */
  id: string

  /** 用户自定义名称 */
  name: string

  /**
   * API 配置来源
   * - 'reuse_llm': 复用当前 LLM 配置的 baseUrl/apiKey
   * - 'custom': 独立配置
   */
  apiSource: 'reuse_llm' | 'custom'

  /** Embedding 模型名称（如 'nomic-embed-text'） */
  model: string

  // apiSource === 'custom' 时使用
  baseUrl?: string
  apiKey?: string

  /** 创建时间戳 */
  createdAt: number

  /** 更新时间戳 */
  updatedAt: number
}

/**
 * Embedding 配置存储
 */
export interface EmbeddingConfigStore {
  /** 所有配置 */
  configs: EmbeddingServiceConfig[]

  /** 当前激活的配置 ID */
  activeConfigId: string | null

  /** 是否启用语义搜索 */
  enabled: boolean
}

/**
 * 最大配置数量
 */
export const MAX_EMBEDDING_CONFIG_COUNT = 10

/**
 * 默认 Embedding 配置存储
 */
export const DEFAULT_EMBEDDING_CONFIG_STORE: EmbeddingConfigStore = {
  configs: [],
  activeConfigId: null,
  enabled: false,
}

// ==================== 旧版 EmbeddingConfig（兼容） ====================

/**
 * Embedding 配置（旧版，用于兼容）
 * @deprecated 使用 EmbeddingServiceConfig 代替
 */
export interface EmbeddingConfig {
  /** 是否启用 Embedding */
  enabled: boolean

  /**
   * 提供商类型（目前固定为 'api'）
   */
  provider: 'api'

  /**
   * API 配置来源
   * - 'reuse_llm': 复用当前 LLM 配置的 baseUrl/apiKey
   * - 'custom': 独立配置
   */
  apiSource?: 'reuse_llm' | 'custom'

  /** Embedding 模型名称（如 'nomic-embed-text'） */
  model?: string

  // apiSource === 'custom' 时使用
  baseUrl?: string
  apiKey?: string
}

// ==================== 向量存储相关类型 ====================

/**
 * 向量存储配置
 */
export interface VectorStoreConfig {
  /** 是否启用向量缓存 */
  enabled: boolean

  /**
   * 存储类型
   * - 'memory': 仅内存缓存（重启后丢失）
   * - 'sqlite': SQLite 持久化（推荐）
   * - 'lancedb': LanceDB（预留，需解决 Electron 打包）
   */
  type: 'memory' | 'sqlite' | 'lancedb'

  // type === 'memory' 时的选项
  /** LRU 缓存大小（条目数） */
  memoryCacheSize?: number

  // type === 'sqlite' 时的选项
  /** 数据库路径（默认 {userData}/data/ai/vectors/embeddings.db） */
  dbPath?: string
}

// ==================== Rerank 相关类型（预留） ====================

/**
 * Rerank 配置（预留）
 */
export interface RerankConfig {
  /** 是否启用重排 */
  enabled: boolean

  /** 提供商 */
  provider: 'jina' | 'cohere' | 'bge' | 'custom'

  /** 模型名称 */
  model?: string

  /** API 端点 */
  baseUrl?: string

  /** API Key */
  apiKey?: string

  /** 重排后返回的数量 */
  topK?: number
}

// ==================== RAG 配置 ====================

/**
 * RAG 完整配置
 */
export interface RAGConfig {
  /** Embedding 配置 */
  embedding?: EmbeddingConfig

  /** 向量存储配置 */
  vectorStore?: VectorStoreConfig

  /** Rerank 配置（预留） */
  rerank?: RerankConfig

  // Pipeline 配置

  /** 是否启用 Semantic Pipeline（自动语义搜索） */
  enableSemanticPipeline?: boolean

  /** 候选切片数量上限 */
  candidateLimit?: number

  /** 返回结果数量 */
  topK?: number
}

/**
 * 默认 RAG 配置
 */
export const DEFAULT_RAG_CONFIG: RAGConfig = {
  embedding: {
    enabled: false,
    provider: 'api',
    apiSource: 'reuse_llm',
  },
  vectorStore: {
    enabled: true,
    type: 'sqlite',
  },
  enableSemanticPipeline: true,
  candidateLimit: 50,
  topK: 10,
}

// ==================== Embedding 服务接口 ====================

/**
 * Embedding 服务接口
 */
export interface IEmbeddingService {
  /** 获取提供商名称 */
  getProvider(): string

  /** 获取向量维度 */
  getDimensions(): number

  /** 嵌入单条文本 */
  embed(text: string): Promise<number[]>

  /** 批量嵌入文本 */
  embedBatch(texts: string[]): Promise<number[][]>

  /** 验证服务可用性 */
  validate(): Promise<{ success: boolean; error?: string }>

  /** 释放资源 */
  dispose(): Promise<void>
}

/**
 * Embedding 结果
 */
export interface EmbeddingResult {
  /** 原始文本 */
  text: string
  /** 向量 */
  vector: number[]
  /** 向量维度 */
  dimensions: number
}

// ==================== 向量存储服务接口 ====================

/**
 * 向量存储接口
 */
export interface IVectorStore {
  /** 添加向量 */
  add(id: string, vector: number[], metadata?: Record<string, unknown>): Promise<void>

  /** 批量添加向量 */
  addBatch(items: Array<{ id: string; vector: number[]; metadata?: Record<string, unknown> }>): Promise<void>

  /** 获取向量 */
  get(id: string): Promise<number[] | null>

  /** 检查是否存在 */
  has(id: string): Promise<boolean>

  /** 删除向量 */
  delete(id: string): Promise<void>

  /** 相似度搜索 */
  search(query: number[], topK: number): Promise<VectorSearchResult[]>

  /** 清空存储 */
  clear(): Promise<void>

  /** 获取存储统计 */
  getStats(): Promise<VectorStoreStats>

  /** 关闭存储 */
  close(): Promise<void>
}

/**
 * 向量搜索结果
 */
export interface VectorSearchResult {
  id: string
  score: number
  metadata?: Record<string, unknown>
}

/**
 * 存储统计
 */
export interface VectorStoreStats {
  count: number
  dimensions?: number
  sizeBytes?: number
}

// ==================== 切片相关类型 ====================

/**
 * 切片结果
 */
export interface Chunk {
  /** 切片 ID（如 session_123） */
  id: string

  /** 切片类型 */
  type: 'session' | 'window' | 'time'

  /** 用于 Embedding 的文本内容 */
  content: string

  /** 元数据 */
  metadata: ChunkMetadata
}

/**
 * 切片元数据
 */
export interface ChunkMetadata {
  sessionId?: number
  startTs: number
  endTs: number
  messageCount: number
  participants: string[]

  /** 子切片索引（从 0 开始，仅当会话被拆分时存在） */
  subChunkIndex?: number

  /** 总子切片数（仅当会话被拆分时存在） */
  totalSubChunks?: number
}

// ==================== Rerank 服务接口（预留） ====================

/**
 * Rerank 服务接口（预留）
 */
export interface IRerankService {
  /** 重排文档 */
  rerank(query: string, documents: string[], topK?: number): Promise<RerankResult[]>

  /** 验证服务可用性 */
  validate(): Promise<{ success: boolean; error?: string }>
}

/**
 * 重排结果
 */
export interface RerankResult {
  index: number
  score: number
  text: string
}

// ==================== Pipeline 相关类型 ====================

/**
 * Semantic Pipeline 选项
 */
export interface SemanticPipelineOptions {
  /** 用户原始问题 */
  userMessage: string

  /** 数据库路径 */
  dbPath: string

  /** 时间过滤器 */
  timeFilter?: { startTs: number; endTs: number }

  /** 候选切片数量 */
  candidateLimit?: number

  /** 返回结果数量 */
  topK?: number

  /** 是否使用重排 */
  useRerank?: boolean

  /** 中止信号 */
  abortSignal?: AbortSignal
}

/**
 * Semantic Pipeline 结果
 */
export interface SemanticPipelineResult {
  /** 是否成功执行 */
  success: boolean

  /** 改写后的 query */
  rewrittenQuery?: string

  /** 检索结果 */
  results: Array<{
    score: number
    chunkId: string
    content: string
    metadata?: ChunkMetadata
  }>

  /** 格式化的证据块（用于注入 System Prompt） */
  evidenceBlock?: string

  /** 错误信息 */
  error?: string
}
