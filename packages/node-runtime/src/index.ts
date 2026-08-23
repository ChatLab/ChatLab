/**
 * @openchatlab/node-runtime
 *
 * Node.js 运行时适配器，提供 better-sqlite3 数据库适配器、
 * 路径管理、数据库连接管理等平台特定实现。
 */

export { BetterSqliteAdapter, openBetterSqliteDatabase } from './better-sqlite3-adapter'
export {
  CHATLAB_TEMP_ROOT_ENV,
  createChatLabTempDir,
  ensureChatLabTempRoot,
  getChatLabTempScopeDir,
  removeChatLabTempDir,
  resolveChatLabTempRoot,
} from './temp-workspace'
export type { ChatLabTempRootOptions, ChatLabTempScope } from './temp-workspace'

// Import data writing + perf logging + streaming importer + incremental importer
export {
  writeParseResultToDb,
  streamingImport,
  analyzeNewImport,
  streamParseFileInfo,
  analyzeIncrementalImport,
  incrementalImport,
  resolveAutoImportTarget,
  resolveAutoImportTargetPlan,
  analyzeAutoImportFile,
  autoImportFile,
  autoImportBatch,
  normalizeBatchConcurrency,
  resolveDefaultBatchConcurrency,
  runKeyedBatch,
  isValidImportSessionId,
  IMPORT_IN_PROGRESS_ERROR_KEY,
  IMPORT_LOCK_FILENAME,
  ImportInProgressError,
  withDataDirImportLock,
  logNativeParserStatus,
  ZipArchiveReader,
  validateArchiveEntryName,
  ArchiveImportError,
  GoogleChatTakeoutResolver,
  ArchiveImportSourceManager,
  MessageBatchInserter,
  MESSAGE_INSERT_MAX_ROWS,
} from './import'
export type {
  ImportMeta,
  WriteParseResultStats,
  SkipReasons,
  ImportDiagnostics,
  ImportStageTimings,
  ImportPerformanceDiagnostics,
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
  SenderPlatformIdMapping,
  AutoImportDecision,
  AutoImportCreateReason,
  AutoImportMatcherDeps,
  AutoImportMatchMethod,
  AutoImportTargetPlan,
  AutoImportAnalysisDeps,
  AutoImportAnalysisResult,
  AutoImportDeps,
  AutoImportOptions,
  AutoImportResult,
  AutoImportBatchItem,
  AutoImportBatchItemResult,
  AutoImportBatchOptions,
  KeyedBatchOptions,
  KeyedBatchTask,
  KeyedBatchTaskResult,
  ArchiveEntrySummary,
  ArchiveEntryStreamOpener,
  ArchiveEntryVisitor,
  ZipArchiveReaderOptions,
  PreparedImportChat,
  PreparedImportSource,
  MaterializedImport,
  ArchiveResolver,
  MessageInsertRow,
} from './import'
export {
  LogLevel,
  createImportPerfLogger,
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

// AI Logger & Error formatting
export { AiLogger, extractErrorInfo, extractErrorStack, formatAIError } from './ai'
export type { FormatAIErrorOptions } from './ai'

// Unified application logger (general + key-path + crash logs)
export { initAppLogger, appLogger } from './logging/app-logger'
export {
  NodePathProvider,
  applyPendingNodeDataDirMigrationIfNeeded,
  getDefaultNodeUserDataDir,
  getSystemLogsDir,
  hasPendingElectronDataWarning,
} from './node-path-provider'
export { DatabaseManager, listDatabaseCandidateIds } from './database-manager'
export { createJiebaNlpProvider } from './jieba-nlp-provider'
export {
  applyPendingNodeDataDirMigration,
  clearPendingNodeDataDirMigration,
  copyDirMerge as copyDataDirMerge,
  createNodeDataDirSwitch,
  createPendingDataDirMigration,
  deletePendingDataDirCleanup,
  dismissPendingDataDirCleanupNotice,
  getPendingDataDirCleanups,
  getPendingNodeDataDirMigration,
  isDirectoryEmptyOrMissing,
  isExistingUserDataDir,
  isUserDataDirSafeToUse,
  registerPendingDataDirCleanup,
  runPendingDataDirMigration,
} from './data-dir-switch'
export type {
  ApplyPendingNodeDataDirMigrationDeps,
  CopyStats as DataDirCopyStats,
  DataDirSwitchResult,
  DeletePendingDataDirCleanupDeps,
  PendingDataDirCleanup,
  PendingDataDirMigration,
  RunPendingDataDirMigrationDeps,
  RunPendingDataDirMigrationResult,
} from './data-dir-switch'
export {
  assertDataDirCompatible,
  DataDirCompatibilityError,
  isRuntimeVersionAtLeast,
  raiseDataDirMinRuntimeVersion,
  readDataDirCompatibilityMeta,
} from './data-dir-compat'
export { raiseChatDbCompatibilityGate } from './migrations/chat-db-migrations'
export type {
  AssertDataDirCompatibilityOptions,
  DataDirCompatibilityMeta,
  RaiseDataDirCompatibilityInput,
  RuntimeIdentity,
  RuntimeKind,
} from './data-dir-compat'

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
} from './nlp'

// AI 助手/技能解析器 + 对话管理
export type {
  AssistantConfig,
  AssistantSummary,
  AssistantUpgradeInfo,
  AssistantUpgradeResult,
  SkillDef,
  SkillSummary,
} from './ai'
export {
  parseAssistantFile,
  serializeAssistant,
  parseSkillFile,
  extractSkillId,
  DEFAULT_GENERAL_ASSISTANT_CONFIGS,
  DEFAULT_GENERAL_ASSISTANT_RAW_CONFIGS,
  LEGACY_GENERAL_ASSISTANT_DIGESTS,
} from './ai'
export { AIChatManager } from './ai'
export { countTokens, countMessagesTokens, initTokenizer } from './ai'
export { createFileConfigStorage, createAuthProfileLlmConfigStore, createLlmRuntimeStores } from './ai'
export type { AuthProfileLlmConfigStoreDeps, CreateLlmRuntimeStoresOptions, LlmRuntimeStores } from './ai'

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
export { DEFAULT_CONTEXT_COMPRESSION_CONFIG, checkAndCompress, manualCompress, createCompressionLlmAdapter } from './ai'
export type { CreateCompressionLlmAdapterOptions } from './ai'

// SkillManager
export { SkillManager } from './ai'
export {
  CHART_CAPABILITY_ANALYSIS_TOOLS,
  CHART_CAPABILITY_CORE_TOOLS,
  CHART_CAPABILITY_SKILL_ID,
  buildSkillMenuWithBuiltinChart,
  getAllowedBuiltinToolsForChartAutoSkill,
  getChartCapabilityAllowedBuiltinTools,
  getChartCapabilitySkill,
  getChartPlannerCapabilityForMessage,
  getBuiltinChartSkill,
  getSkillConfigWithBuiltinChart,
  resolveChartRuntimeForRequest,
  shouldOfferChartCapabilityForAnalyticalMessage,
  shouldUseChartCapabilityForMessage,
  CHART_SCHEMA_REQUIRED_MESSAGE,
  createChartSchemaGateState,
  wrapWithChartSchemaGate,
} from './ai'
export type { ChartSchemaGateState } from './ai'

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
  DesensitizeRuleGroup,
  TruncationStrategy,
  PreprocessLogger,
} from './ai'
export {
  preprocessMessages,
  preprocessMessagesWithStats,
  desensitizeText,
  matchesBlacklist,
  BUILTIN_DESENSITIZE_RULES,
  DESENSITIZE_RULES_SCHEMA_VERSION,
  applyDesensitizeRuleOverrides,
  getDefaultRulesForLocale,
  getRuleGroupsForLocale,
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
export type {
  PreprocessingPipelineOptions,
  PreprocessingPipelineResult,
  PipelineStats,
  PreprocessStats,
  FormatMessageOptions,
} from './ai'

export type {
  AIChat,
  AIChatKind,
  AIEntityRef,
  AIHistoryMessage,
  AIMessage,
  AIMessageRole,
  ContentBlock,
  TokenUsageData,
  AIChatManagerLogger,
} from './ai'

// Agent Core
export type { AgentCoreOptions, AgentCoreEvent, AgentCoreResult, AgentTokenUsage, SimpleHistoryMessage } from './ai'
export { DEFAULT_MAX_TOOL_ROUNDS, createLlmRouteDecider, decideRequestRoute, runAgentCore } from './ai'
export type { LlmRouteDecider, RequestRoute, RouteDecision, RouteDecisionSource, RouterInput } from './ai'
export { buildPlanGuidance, createAnalysisPlanner, createDataSnapshotFromOverview, createPlanContentBlock } from './ai'
export { buildSemanticSearchGuidance } from './ai'
export {
  CROSS_CHAT_MAX_TOOL_RESULT_TOKENS,
  buildCrossChatSystemPrompt,
  resolveCrossChatToolResultTokenBudget,
  runCrossChatAgent,
} from './ai'
export type { CrossChatAgentLogger, RunCrossChatAgentOptions } from './ai'
export type {
  AnalysisPlanIntent,
  AnalysisPlanner,
  AnalysisPlanStep,
  AnalysisPlanSummary,
  PlannerCapabilitySummary,
  PlannerInput,
  PlanContentBlock,
  PlanDraftContentBlock,
  ChatOverviewForSnapshot,
} from './ai'

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

// Export engine
export { exportFilterResultToMarkdown, exportWithFormat } from './export'
export type {
  ExportFilterParams,
  ExportProgress,
  ExportProgressCallback,
  ExportWriter,
  ExportDeps,
  ExportResult,
  ExportFormat,
  FormatExportParams,
  FormatExportResult,
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
  getValidatedOverviewCache,
  getDbFileVersion,
  getOrComputeAnalysisCache,
  CACHE_KEY_OVERVIEW,
  CACHE_KEY_MEMBERS,
} from './cache'
export type { OverviewCache, MembersCache, MemberStat } from './cache'

// Chat DB migrations
export { getChatDbMigrations } from './migrations'

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

// Shared application services (session / member / index / summary / export / analytics)
export { AnalyticsService } from './services/analytics'
export * as sessionService from './services/session-service'
export * as memberService from './services/member-service'
export * as sessionIndexService from './services/session-index-service'
export * as summaryService from './services/summary-service'
export * as exportService from './services/export-service'
export * as ownerProfileService from './services/owner-profile-service'
export {
  importDemoSessions,
  type DemoImportFileResult,
  type DemoImportProgress,
  type DemoImportResult,
  type ImportDemoSessionsOptions,
} from './services/demo-import'
export * as contactsService from './services/contacts'
export * as crossChatAnalysisService from './services/cross-chat-analysis'
export * as peopleRelationshipsService from './services/people/relationships'
export * as globalInsightService from './services/global-insight'
// Semantic index (Phase 1 vector search) — independent of legacy ai/rag
export * as semanticIndex from './semantic-index'
export {
  SemanticIndexService,
  createSemanticIndexService,
  defaultSemanticIndexConfig,
  SemanticIndexConfigStore,
  SEMANTIC_INDEX_CONFIG_FILE,
  isSemanticIndexConfigured,
  persistSemanticIndexConfig,
  resolveSemanticIndexApiKeySet,
  createSemanticIndexWorkerRuntimeClient,
  createLocalEmbeddingRuntimeManager,
} from './semantic-index'
export type {
  SemanticIndexServiceOptions,
  SemanticIndexRuntime,
  SemanticIndexWorkerRuntimeClientOptions,
  SemanticIndexSessionStatus,
  SemanticSearchResult,
  SemanticSearchReason,
  SemanticSearchToolResult,
  SemanticSearchToolSource,
  SemanticSearchToolOptions,
  SemanticIndexConfig,
  SemanticIndexMode,
  SemanticIndexModelDownloadSource,
  LocalEmbeddingRuntimeConfig,
} from './semantic-index'

export {
  CONTACTS_ALGORITHM_VERSION,
  PEOPLE_RELATIONSHIPS_ALGORITHM_VERSION,
  ANNUAL_SUMMARY_ALGORITHM_VERSION,
  TIME_INVESTMENT_ALGORITHM_VERSION,
  MergeSessionCache,
  createContactsService,
  createCrossChatAnalysisService,
  preprocessCrossChatMessages,
  createPeopleRelationshipsService,
  createGlobalInsightService,
  assertValidTopicDayKey,
  ChatTopicStore,
  createChatTopicModelClient,
  createChatTopicService,
  chatTopicWorkCoordinator,
  deleteSessionChatTopics,
  getChatTopicsDbPath,
  getChatTopicsDir,
  createTimeInvestmentService,
  createNavigationLayoutService,
  NavigationLayoutValidationError,
  createDatabaseManagerAdapter,
  executePushImportUnlocked,
  DEFAULT_IMPORT_IDEMPOTENCY_TTL_MS,
  hashImportBody,
  ImportIdempotencyCache,
  pushImport,
} from './services'
export type {
  SessionRuntimeAdapter,
  AnalysisSessionDTO,
  ListSessionsOptions,
  MembersPaginatedDTO,
  LlmConfig,
  SummaryServiceDeps,
  ApplyOwnerProfileReason,
  ApplyOwnerProfileResult,
  SetOwnerAndApplyProfileResult,
  ContactsService,
  ContactsServiceDeps,
  ContactsServiceOptions,
  CrossChatAnalysisService,
  CrossChatAnalysisServiceDeps,
  CrossChatEntityResolution,
  CrossChatMessageContextRequest,
  CrossChatMessageContextResult,
  CrossChatMessageSource,
  CrossChatOperationOptions,
  CrossChatPrivateContactRankItem,
  CrossChatPrivateContactsRankBy,
  CrossChatPrivateContactsRankingRequest,
  CrossChatPrivateContactsRankingResult,
  CrossChatOverviewItem,
  CrossChatOverviewRequest,
  CrossChatOverviewResult,
  CrossChatRecentSessionResult,
  CrossChatRecentSessionSummary,
  CrossChatResolvedContact,
  CrossChatResolvedContactSession,
  CrossChatResolvedSession,
  CrossChatSearchProgress,
  CrossChatSearchRequest,
  CrossChatSearchResult,
  CrossChatSearchScope,
  CrossChatSessionDescriptor,
  CrossChatTruncationReason,
  CrossChatUnresolvedEntity,
  PeopleRelationshipsService,
  PeopleRelationshipsServiceDeps,
  PeopleRelationshipsServiceOptions,
  ChatTopicModelClient,
  ChatTopicModelResult,
  ChatTopicService,
  ChatTopicServiceDeps,
  AnnualSummaryComputeRunner,
  GlobalInsightService,
  GlobalInsightServiceDeps,
  ImportIdempotencyStartResult,
  PushImportAnalysisOutcome,
  PushImportAnalysisResult,
  PushImportExecutionDeps,
  GlobalInsightServiceOptions,
  FinalizeTopicDayInput,
  TopicDayCheckpoint,
  TimeInvestmentComputeRunner,
  TimeInvestmentService,
  TimeInvestmentServiceDeps,
  TimeInvestmentServiceOptions,
  NavigationLayoutService,
  PushImportPayload,
  PushImportResult,
  PushImportOutcome,
  PushImportMessage,
  PushImportMember,
  PushImportMeta,
} from './services'
