/**
 * @openchatlab/node-runtime
 *
 * Node.js 运行时适配器，提供 better-sqlite3 数据库适配器、
 * 路径管理、数据库连接管理等平台特定实现。
 */

export { BetterSqliteAdapter, openBetterSqliteDatabase } from './better-sqlite3-adapter'

// Import data writing + perf logging + streaming importer + incremental importer
export {
  writeParseResultToDb,
  streamingImport,
  analyzeNewImport,
  streamParseFileInfo,
  analyzeIncrementalImport,
  incrementalImport,
} from './import'
export type {
  ImportMeta,
  WriteParseResultStats,
  SkipReasons,
  ImportDiagnostics,
  StreamImportResult,
  ImportProgressCallback,
  ImportLogger,
  StreamImportDeps,
  AnalyzeNewImportResult,
  StreamParseFileInfoResult,
  StreamParseFileInfoDeps,
  ImportOptions,
  IncrementalAnalyzeResult,
  IncrementalImportResult,
  IncrementalImportDeps,
} from './import'
export {
  LogLevel,
  initPerfLog,
  logPerf,
  logPerfDetail,
  resetPerfLog,
  getCurrentLogFile,
  logError,
  logInfo,
  getErrorCount,
  logSummary,
} from './import'

// FTS5 full-text search operations
export { hasFtsTable, createFtsTable, buildFtsIndex, rebuildFtsIndex, insertFtsEntries, searchByFts } from './fts'

// AI Logger & Error formatting
export { AiLogger, extractErrorInfo, extractErrorStack, formatAIError } from './ai'
export type { FormatAIErrorOptions } from './ai'
export {
  NodePathProvider,
  applyPendingNodeDataDirMigrationIfNeeded,
  getDefaultNodeUserDataDir,
  hasPendingElectronDataWarning,
} from './node-path-provider'
export { DatabaseManager } from './database-manager'
export { createJiebaNlpProvider } from './jieba-nlp-provider'
export {
  applyPendingNodeDataDirMigration,
  clearPendingNodeDataDirMigration,
  copyDirMerge as copyDataDirMerge,
  createNodeDataDirSwitch,
  createPendingDataDirMigration,
  getPendingNodeDataDirMigration,
  isDirectoryEmptyOrMissing,
  isExistingUserDataDir,
  isUserDataDirSafeToUse,
  runPendingDataDirMigration,
} from './data-dir-switch'
export type {
  ApplyPendingNodeDataDirMigrationDeps,
  CopyStats as DataDirCopyStats,
  DataDirSwitchResult,
  PendingDataDirMigration,
  RunPendingDataDirMigrationDeps,
  RunPendingDataDirMigrationResult,
} from './data-dir-switch'

// NLP 分词引擎、词频统计、词库管理
export {
  initNlpDir,
  getNlpDir,
  getJieba,
  clearJiebaInstance,
  segment,
  batchSegmentWithFrequency,
  collectPosTagStats,
  getPosTagDefinitions,
  computeWordFrequency,
  segmentText,
  isDictDownloaded,
  getDictList,
  loadDictBuffer,
  downloadDict,
  deleteDict,
  ensureDefaultDict,
  tokenizeForFts,
  tokenizeQueryForFts,
} from './nlp'

// AI 助手/技能解析器 + 对话管理
export type { AssistantConfig, AssistantSummary, SkillDef, SkillSummary } from './ai'
export { parseAssistantFile, serializeAssistant, parseSkillFile, extractSkillId } from './ai'
export { AIConversationManager } from './ai'
export { countTokens, countMessagesTokens, initTokenizer } from './ai'

// Assistant Manager
export { AssistantManager } from './ai'
export type {
  AssistantInitResult,
  AssistantSaveResult,
  BuiltinAssistantInfo,
  AssistantManagerFs,
  AssistantManagerDeps,
} from './ai'

// Compression
export type { CompressionConfig, CompressionResult, CompressionLogger, CompressionLlmAdapter } from './ai'
export { checkAndCompress, manualCompress, createCompressionLlmAdapter } from './ai'
export type { CreateCompressionLlmAdapterOptions } from './ai'

// SkillManager
export { SkillManager } from './ai'

// SkillManagerCore
export { SkillManagerCore } from './ai'
export type {
  SkillInitResult,
  SkillManagerSaveResult,
  BuiltinSkillInfo,
  SkillManagerFs,
  SkillManagerCoreDeps,
} from './ai'
export type { SkillManagerLogger, ActivateSkillToolOptions, ActivateSkillTool, ActivateSkillToolResult } from './ai'
export { createActivateSkillTool } from './ai'

// Preprocessor
export type {
  PreprocessConfig,
  PreprocessableMessage,
  DesensitizeRule,
  TruncationStrategy,
  PreprocessLogger,
} from './ai'
export {
  preprocessMessages,
  BUILTIN_DESENSITIZE_RULES,
  getDefaultRulesForLocale,
  mergeRulesForLocale,
  formatMessageCompact,
  formatTimeRange,
  formatToolResultAsText,
  anonymizeMessageNames,
  truncateFormattedMessages,
  isChineseLocale,
  i18nTexts,
  t,
  applyPreprocessingPipeline,
} from './ai'
export type { PreprocessingPipelineOptions, PreprocessingPipelineResult } from './ai'

export type {
  AIConversation,
  AIMessage,
  AIMessageRole,
  ContentBlock,
  TokenUsageData,
  ConversationManagerLogger,
} from './ai'

// Agent Core
export type { AgentCoreOptions, AgentCoreEvent, AgentCoreResult, AgentTokenUsage, SimpleHistoryMessage } from './ai'
export { runAgentCore } from './ai'

// Summary generation
export {
  generateSessionSummary,
  generateSessionSummaries,
  checkSessionsCanGenerateSummary,
  isValidMessage,
  filterValidMessages,
  splitIntoSegments,
} from './ai'
export type { SummaryDeps, SummaryMessage, SummaryOptions, SummaryResult, SummaryStrategy } from './ai'

// LLM Config Store
export { LLMConfigStore, MAX_CONFIG_COUNT } from './ai'
export type { AIServiceConfig, AIConfigStore, ConfigStorage, LLMConfigStoreDeps } from './ai'

// Custom Provider/Model Store
export { CustomProviderStore, CustomModelStore } from './ai'

// Agent Event Handler
export { AgentEventHandler, estimateTokensFromText } from './ai'
export type { TokenUsage, AgentRuntimeStatus, AgentStreamChunk, EventHandlerConfig, EventHandlerContext } from './ai'

// Agent Prompt Builder
export { buildSystemPrompt, createAiTranslate, aiLocales } from './ai'
export type {
  BuildSystemPromptOptions,
  DataSnapshot,
  OwnerInfo,
  MentionedMember,
  SkillContext,
  TranslateFn,
} from './ai'

// LLM Model Builder
export { buildPiModel, normalizeAnthropicBaseUrl, normalizeOpenAICompatibleBaseUrl } from './ai'
export type { PiModelConfig, BuildPiModelOptions } from './ai'

// Remote LLM API
export { fetchRemoteModels, validateApiKey } from './ai'
export type { RemoteModel, FetchRemoteModelsResult, RemoteApiOptions } from './ai'

// Markdown export engine
export { exportFilterResultToMarkdown } from './export'
export type {
  ExportFilterParams,
  ExportProgress,
  ExportProgressCallback,
  ExportWriter,
  ExportDeps,
  ExportResult,
} from './export'

// Session cache (overview + members JSON file cache)
export {
  getCachePath,
  getCache,
  setCache,
  invalidateCache,
  deleteSessionCache,
  computeAndSetOverviewCache,
  computeAndSetMembersCache,
  CACHE_KEY_OVERVIEW,
  CACHE_KEY_MEMBERS,
} from './cache'
export type { OverviewCache, MembersCache, MemberStat } from './cache'

// Chat DB migrations
export { getChatDbMigrations } from './migrations'
export type { MigrationDeps } from './migrations'

// Electron data migration (CLI first-run) + data path verification
export { migrateFromElectronIfNeeded, verifyCliDataPath, wasElectronUsed } from './migrations'
export type { ElectronMigrationResult } from './migrations'

// Preferences manager (preferences.json)
export { PreferencesManager } from './preferences'
export type {
  Preferences,
  AIGlobalSettings,
  AIPreprocessConfig,
  WordFilterScheme,
  KeywordTemplate,
  ContextCompressionSettings,
} from './preferences'

// Merger orchestration
export { checkConflictsFromSources, buildMergedOutput, serializeChatLabToJsonl } from './merger'
export type {
  MergerDataSource,
  MergerSourceMeta,
  MergeSourceInfo,
  ChatLabHeader,
  ChatLabMeta,
  ChatLabOutput,
  MergeOrchestrationResult,
} from './merger'
export {
  TempDbWriter,
  TempDbReader,
  exportSessionToJson,
  deleteTempDatabase,
  cleanupTempDatabases,
  TEMP_DB_SCHEMA,
} from './merger/temp-db'
export type { TempDbMeta, ExportedSession } from './merger/temp-db'

// Re-exports: @earendil-works/pi-agent-core & @earendil-works/pi-ai
export type { AgentTool, AgentToolResult } from './ai'
export { Type, completeSimple, streamSimple, runSimpleLlmStream } from './ai'
export type { LlmStreamChunk, RunSimpleLlmStreamOptions } from './ai'
export type { PiModel, PiApi, PiMessage, PiUsage, PiTextContent, PiAssistantMessage } from './ai'

// ==================== RAG ====================
export {
  initRag,
  initRagConfig,
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
  getEmbeddingService,
  resetEmbeddingService,
  validateEmbeddingConfig,
  getSessionChunks,
  getSessionChunk,
  formatSessionChunk,
  getVectorStore,
  resetVectorStore,
  getVectorStoreStats,
  SQLiteVectorStore,
  MemoryVectorStore,
  executeSemanticPipeline,
  cosineSimilarity,
  DEFAULT_RAG_CONFIG,
  DEFAULT_EMBEDDING_CONFIG_STORE,
  MAX_EMBEDDING_CONFIG_COUNT,
} from './ai'
export type {
  RagInitOptions,
  RagLogger,
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
  LLMConfigForEmbedding,
  SemanticPipelineLLMConfig,
  ChunkingOptions,
  SessionMessage,
  SessionInfo,
} from './ai'

// Shared application services (session / member / index / summary / export)
export * as sessionService from './services/session-service'
export * as memberService from './services/member-service'
export * as sessionIndexService from './services/session-index-service'
export * as summaryService from './services/summary-service'
export * as exportService from './services/export-service'
export { createDatabaseManagerAdapter, MergeSessionCache } from './services'
export type {
  SessionRuntimeAdapter,
  AnalysisSessionDTO,
  ListSessionsOptions,
  MembersPaginatedDTO,
  LlmConfig,
  SummaryServiceDeps,
} from './services'
