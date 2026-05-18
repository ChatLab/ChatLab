/**
 * @openchatlab/node-runtime
 *
 * Node.js 运行时适配器，提供 better-sqlite3 数据库适配器、
 * 路径管理、数据库连接管理等平台特定实现。
 */

export { BetterSqliteAdapter, openBetterSqliteDatabase } from './better-sqlite3-adapter'

// AI Logger
export { AiLogger, extractErrorInfo, extractErrorStack } from './ai'
export { NodePathProvider } from './node-path-provider'
export { DatabaseManager } from './database-manager'
export { createJiebaNlpProvider } from './jieba-nlp-provider'

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
export { countTokens, countMessagesTokens } from './ai'

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
export { checkAndCompress, manualCompress } from './ai'

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
export type { SummaryDeps, SummaryMessage, SummaryOptions, SummaryResult } from './ai'

// LLM Config Store
export { LLMConfigStore, MAX_CONFIG_COUNT } from './ai'
export type { AIServiceConfig, AIConfigStore, ConfigStorage, LLMConfigStoreDeps } from './ai'

// Agent Event Handler
export { AgentEventHandler, estimateTokensFromText } from './ai'
export type { TokenUsage, AgentRuntimeStatus, AgentStreamChunk, EventHandlerConfig, EventHandlerContext } from './ai'

// Agent Prompt Builder
export { buildSystemPrompt } from './ai'
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

// Re-exports: @mariozechner/pi-agent-core & @mariozechner/pi-ai
export type { AgentTool, AgentToolResult } from './ai'
export { Type, completeSimple, streamSimple } from './ai'
export type { PiModel, PiApi, PiMessage, PiUsage, PiTextContent, PiAssistantMessage } from './ai'
