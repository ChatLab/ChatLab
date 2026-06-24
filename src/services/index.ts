/**
 * Service 层统一入口
 *
 * 导出 initServices() 和各 useXxxService() composable。
 * 各 Phase 实施时在此追加导出。
 */

export { initServices, detectPlatform, type Platform } from './registry'

export { useDataService } from './data/service'
export type { DataAdapter } from './data/types'
export type {
  PaginationParams,
  PaginatedResult,
  SQLResult,
  TableSchema,
  MentionGraphData,
  MessageLengthDistribution,
} from './data/types'

export { useImportService } from './import/service'
export type {
  ImportAdapter,
  ImportOptions,
  ImportResult,
  ImportDiagnosticsInfo,
  FormatInfo,
  MultiChatEntry,
  PreparedImportChat,
  PreparedImportSource,
  PreparedImportSourceResult,
  DemoProgress,
  DemoImportResult,
  IncrementalAnalysis,
  IncrementalImportResult,
} from './import/types'
export { useSessionIndexService } from './session-index/service'
export { useSemanticIndexService } from './semantic-index/service'
export type { ModelDownloadStatus } from './semantic-index/service'
export { SEARCH_MAX_RESULTS_MIN, SEARCH_MAX_RESULTS_MAX, SEARCH_MAX_RESULTS_DEFAULT } from './semantic-index/types'
export type {
  SemanticIndexConfig,
  SemanticIndexMode,
  SemanticIndexApiConfig,
  SemanticIndexSessionStatus,
  SemanticIndexStatusValue,
} from './semantic-index/types'
export type {
  SessionIndexAdapter,
  SessionStats,
  ChatSessionItem,
  SummaryResult,
  BatchSummaryResult,
  CanGenerateInfo,
} from './session-index/types'
export { useMessageService } from './message/service'
export type { MessageAdapter, TimeFilter, MessageRecord, PaginatedMessages, SearchResult } from './message/types'
export { usePlatformService } from './platform/service'
export type { PlatformAdapter, OpenDialogOptions, OpenDialogResult, RemoteConfigResult } from './platform/types'
export { useAIService } from './ai/service'
export { usePreferencesService } from './preferences/service'
export { useLLMService } from './llm/service'
export type {
  LLMServiceAdapter,
  AIServiceConfigDisplay,
  AIServiceConfigInput,
  ModelSlot,
  LLMProvider,
  ProviderRegistryItem,
  ModelCatalogItem,
  CustomProviderInput,
  CustomModelInput,
} from './llm/types'
export { useAssistantService } from './assistant/service'
export type { AssistantServiceAdapter } from './assistant/types'
export { useSkillService } from './skill/service'
export type { SkillServiceAdapter } from './skill/types'
export type {
  PreferencesAdapter,
  Preferences,
  UiConfig,
  AIGlobalSettings,
  AIPreprocessConfig,
  WordFilterScheme as PreferencesWordFilterScheme,
} from './preferences/types'
export type {
  AIAdapter,
  AIChat,
  AIMessage,
  AIMessageRole,
  ContentBlock,
  TokenUsageData,
  DesensitizeRule,
  ToolCatalogEntry,
  ToolExecuteResult,
  ExportFilterParams,
  AiSQLResult,
  AiSchemaTable,
} from './ai/types'
