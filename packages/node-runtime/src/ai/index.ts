/**
 * AI 模块（Node.js 实现）
 *
 * 助手/技能 MD 文件解析器、共享类型、对话管理、Agent Core。
 */

// AI Logger
export { AiLogger, extractErrorInfo, extractErrorStack } from './ai-logger'

// Error formatting
export { formatAIError } from './error-formatter'
export type { FormatAIErrorOptions } from './error-formatter'

export type {
  AssistantConfig,
  AssistantSummary,
  AssistantUpgradeInfo,
  AssistantUpgradeResult,
  BuiltinAssistantInfo,
} from '@openchatlab/shared-types'
export type { SkillDef, SkillSummary } from './types'
export { parseAssistantFile, serializeAssistant } from './assistant-parser'
export {
  DEFAULT_GENERAL_ASSISTANT_CONFIGS,
  DEFAULT_GENERAL_ASSISTANT_RAW_CONFIGS,
  LEGACY_GENERAL_ASSISTANT_DIGESTS,
} from './default-assistants'

// Assistant Manager
export { AssistantManager } from './assistant-manager'
export type {
  AssistantInitResult,
  AssistantSaveResult,
  AssistantManagerFs,
  AssistantManagerDeps,
} from './assistant-manager'
export { parseSkillFile, extractSkillId } from './skill-parser'
export { AIChatManager } from './chats'
export type { AIChat, AIMessage, AIMessageRole, ContentBlock, TokenUsageData, AIChatManagerLogger } from './chats'

// Tokenizer
export { countTokens, countMessagesTokens, initTokenizer } from './tokenizer'

// SkillManager (runtime: activate-skill tool builder)
export { SkillManager } from './skill-manager'

// SkillManagerCore (CRUD, shared)
export { SkillManagerCore } from './skill-manager-core'
export type {
  SkillInitResult,
  SkillSaveResult as SkillManagerSaveResult,
  BuiltinSkillInfo,
  SkillManagerFs,
  SkillManagerCoreDeps,
} from './skill-manager-core'
export type { SkillManagerLogger } from './skill-manager'
export { createActivateSkillTool } from './activate-skill-tool'
export type { ActivateSkillToolOptions, ActivateSkillTool, ActivateSkillToolResult } from './activate-skill-tool'
export {
  CHART_CAPABILITY_ANALYSIS_TOOLS,
  CHART_CAPABILITY_CORE_TOOLS,
  CHART_CAPABILITY_SKILL_ID,
  buildSkillMenuWithBuiltinChart,
  getAllowedBuiltinToolsForChartAutoSkill,
  getChartCapabilityAllowedBuiltinTools,
  getChartCapabilitySkill,
  getChartCapabilitySkill as getBuiltinChartSkill,
  getChartPlannerCapabilityForMessage,
  getSkillConfigWithBuiltinChart,
  resolveChartRuntimeForRequest,
  shouldOfferChartCapabilityForAnalyticalMessage,
  shouldUseChartCapabilityForMessage,
} from './chart-runtime'
export { CHART_SCHEMA_REQUIRED_MESSAGE, createChartSchemaGateState, wrapWithChartSchemaGate } from './chart-schema-gate'
export type { ChartSchemaGateState } from './chart-schema-gate'

// Compression
export type { CompressionConfig, CompressionResult, CompressionLogger, CompressionLlmAdapter } from './compression'
export { checkAndCompress, manualCompress, createCompressionLlmAdapter } from './compression'
export type { CreateCompressionLlmAdapterOptions } from './compression'

// Preprocessor
export type {
  PreprocessConfig,
  PreprocessableMessage,
  DesensitizeRule,
  DesensitizeRuleGroup,
  TruncationStrategy,
  PreprocessLogger,
} from './preprocessor'
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
} from './preprocessor'
export type {
  PreprocessingPipelineOptions,
  PreprocessingPipelineResult,
  PipelineStats,
  PreprocessStats,
  FormatMessageOptions,
} from './preprocessor'

// Agent Core
export type { AgentCoreOptions, AgentCoreEvent, AgentCoreResult, AgentTokenUsage, SimpleHistoryMessage } from './agent'
export { DEFAULT_MAX_TOOL_ROUNDS, createLlmRouteDecider, decideRequestRoute, runAgentCore } from './agent'
export type { LlmRouteDecider, RequestRoute, RouteDecision, RouteDecisionSource, RouterInput } from './agent'
export { buildPlanGuidance, createAnalysisPlanner, createPlanContentBlock } from './agent'
export { createDataSnapshotFromOverview } from './agent'
export { buildSemanticSearchGuidance } from './agent'
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
} from './agent'

// Agent Event Handler
export { AgentEventHandler, estimateTokensFromText } from './agent/event-handler'
export type {
  TokenUsage,
  AgentRuntimeStatus,
  AgentStreamChunk,
  EventHandlerConfig,
  EventHandlerContext,
} from './agent/event-handler'

// Agent Prompt Builder
export { buildSystemPrompt } from './agent/prompt-builder'
export type {
  BuildSystemPromptOptions,
  DataSnapshot,
  OwnerInfo,
  MentionedMember,
  SkillContext,
  TranslateFn,
} from './agent/prompt-builder'

// AI i18n (shared translations for agent prompts and tool descriptions)
export { createAiTranslate, aiLocales } from './i18n'

// Summary generation
export {
  generateSessionSummary,
  generateSessionSummaries,
  checkSessionsCanGenerateSummary,
  isValidMessage,
  filterValidMessages,
  splitIntoSegments,
} from './summary'
export type { SummaryDeps, SummaryMessage, SummaryOptions, SummaryResult, SummaryStrategy } from './summary'

// LLM Config Store
export { LLMConfigStore, MAX_CONFIG_COUNT } from './llm-config-store'
export type { AIServiceConfig, AIConfigStore, ConfigStorage, LLMConfigStoreDeps } from './llm-config-store'
export { createFileConfigStorage } from './file-config-storage'
export { createAuthProfileLlmConfigStore } from './auth-profile-llm-config-store'
export type { AuthProfileLlmConfigStoreDeps } from './auth-profile-llm-config-store'
export { createLlmRuntimeStores } from './llm-runtime-stores'
export type { CreateLlmRuntimeStoresOptions, LlmRuntimeStores } from './llm-runtime-stores'

// Custom Provider/Model Store
export { CustomProviderStore, CustomModelStore } from './custom-store'

// LLM Model Builder
export { buildPiModel, normalizeAnthropicBaseUrl, normalizeOpenAICompatibleBaseUrl } from './llm-builder'
export type { PiModelConfig, BuildPiModelOptions } from './llm-builder'

// Remote LLM API
export { fetchRemoteModels, validateApiKey } from './remote-api'
export type { RemoteModel, FetchRemoteModelsResult, RemoteApiOptions } from './remote-api'

// Re-exports from @earendil-works/pi-agent-core
export type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'

// LLM simple streaming
export { runSimpleLlmStream } from './llm-stream'
export type { LlmStreamChunk, RunSimpleLlmStreamOptions } from './llm-stream'

// Re-exports from @earendil-works/pi-ai
export { Type, completeSimple, streamSimple } from '@earendil-works/pi-ai'
export type {
  Model as PiModel,
  Api as PiApi,
  Message as PiMessage,
  Usage as PiUsage,
  TextContent as PiTextContent,
  AssistantMessage as PiAssistantMessage,
} from '@earendil-works/pi-ai'
