/**
 * AI 模块（Node.js 实现）
 *
 * 助手/技能 MD 文件解析器、共享类型、对话管理、Agent Core。
 */

// AI Logger
export { AiLogger, extractErrorInfo, extractErrorStack } from './ai-logger'

export type { AssistantConfig, AssistantSummary, SkillDef, SkillSummary } from './types'
export { parseAssistantFile, serializeAssistant } from './assistant-parser'

// Assistant Manager
export { AssistantManager } from './assistant-manager'
export type {
  AssistantInitResult,
  AssistantSaveResult,
  BuiltinAssistantInfo,
  AssistantManagerFs,
  AssistantManagerDeps,
} from './assistant-manager'
export { parseSkillFile, extractSkillId } from './skill-parser'
export { AIConversationManager } from './conversations'
export type {
  AIConversation,
  AIMessage,
  AIMessageRole,
  ContentBlock,
  TokenUsageData,
  ConversationManagerLogger,
} from './conversations'

// Tokenizer
export { countTokens, countMessagesTokens } from './tokenizer'

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

// Compression
export type { CompressionConfig, CompressionResult, CompressionLogger, CompressionLlmAdapter } from './compression'
export { checkAndCompress, manualCompress } from './compression'

// Preprocessor
export type {
  PreprocessConfig,
  PreprocessableMessage,
  DesensitizeRule,
  TruncationStrategy,
  PreprocessLogger,
} from './preprocessor'
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
} from './preprocessor'
export type { PreprocessingPipelineOptions, PreprocessingPipelineResult } from './preprocessor'

// Agent Core
export type { AgentCoreOptions, AgentCoreEvent, AgentCoreResult, AgentTokenUsage, SimpleHistoryMessage } from './agent'
export { runAgentCore } from './agent'

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

// Summary generation
export {
  generateSessionSummary,
  generateSessionSummaries,
  checkSessionsCanGenerateSummary,
  isValidMessage,
  filterValidMessages,
  splitIntoSegments,
} from './summary'
export type { SummaryDeps, SummaryMessage, SummaryOptions, SummaryResult } from './summary'

// LLM Config Store
export { LLMConfigStore, MAX_CONFIG_COUNT } from './llm-config-store'
export type { AIServiceConfig, AIConfigStore, ConfigStorage, LLMConfigStoreDeps } from './llm-config-store'

// LLM Model Builder
export { buildPiModel, normalizeAnthropicBaseUrl, normalizeOpenAICompatibleBaseUrl } from './llm-builder'
export type { PiModelConfig, BuildPiModelOptions } from './llm-builder'

// Remote LLM API
export { fetchRemoteModels, validateApiKey } from './remote-api'
export type { RemoteModel, FetchRemoteModelsResult, RemoteApiOptions } from './remote-api'

// Re-exports from @mariozechner/pi-agent-core
export type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'

// Re-exports from @mariozechner/pi-ai
export { Type, completeSimple, streamSimple } from '@mariozechner/pi-ai'
export type {
  Model as PiModel,
  Api as PiApi,
  Message as PiMessage,
  Usage as PiUsage,
  TextContent as PiTextContent,
  AssistantMessage as PiAssistantMessage,
} from '@mariozechner/pi-ai'
