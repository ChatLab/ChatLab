/**
 * AI 模块（平台无关的静态数据和类型）
 */

// 内置工具目录
export type { ToolCategory, BuiltinToolCatalogEntry } from './tool-catalog'
export { BUILTIN_TOOL_CATALOG, normalizeBuiltinToolName, normalizeBuiltinToolNames } from './tool-catalog'
export { CHART_CAPABILITY_SKILL_ID } from './chart-capability'

// LLM 模型系统类型
export type {
  ProviderKind,
  ProviderDefinition,
  ModelCapability,
  ModelStatus,
  ModelRecommendedFor,
  ModelDefinition,
  ModelSlot,
} from './model-types'

// Provider Registry（内置 provider 目录）
export { BUILTIN_PROVIDERS, getBuiltinProviderById } from './provider-registry'

// Model Catalog（内置模型目录）
export { BUILTIN_MODELS, getBuiltinModelsByProvider, getBuiltinModelById } from './model-catalog'

// Content parsing (thinking-tag extraction, tool-call stripping, avatar sanitization)
export { THINK_TAGS, extractThinkingContent, stripToolCallTags, stripAvatarFields } from './content-parser'

// Streaming think-tag parser (for models that embed <think> in content)
export { StreamingThinkTagParser, needsStreamingThinkParsing } from './streaming-think-parser'
export type { StreamParserEvent } from './streaming-think-parser'

// Thinking / reasoning level configuration (per-model level tables + compat)
export type { ThinkingLevel, ThinkingCompat } from './thinking'
export { getSupportedThinkingLevels, isReasoningModel, getThinkingCompat } from './thinking'

// Tool result text extraction/truncation (persisted into content blocks for history replay)
export { MAX_PERSISTED_TOOL_RESULT_CHARS, extractToolResultText, truncateToolResultText } from './tool-result-text'
