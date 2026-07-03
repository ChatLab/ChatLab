/**
 * 预处理管道（平台无关）
 *
 * 提供消息预处理、格式化、截断和脱敏功能。
 */

export type { PreprocessConfig, PreprocessableMessage, DesensitizeRule, TruncationStrategy } from './types'
export { preprocessMessages, preprocessMessagesWithStats, desensitizeText, matchesBlacklist } from './pipeline'
export type { PreprocessLogger, PreprocessStats } from './pipeline'
export {
  BUILTIN_DESENSITIZE_RULES,
  DESENSITIZE_RULES_SCHEMA_VERSION,
  applyDesensitizeRuleOverrides,
  getDefaultRulesForLocale,
  getRuleGroupsForLocale,
  mergeRulesForLocale,
} from './builtin-rules'
export type { DesensitizeRuleGroup } from './builtin-rules'
export {
  formatMessageCompact,
  formatTimeRange,
  formatToolResultAsText,
  anonymizeMessageNames,
  truncateFormattedMessages,
  isChineseLocale,
  i18nTexts,
  t,
} from './format'
export type { FormatMessageOptions } from './format'

// Preprocessing pipeline
export type { PreprocessingPipelineOptions, PreprocessingPipelineResult, PipelineStats } from './preprocessing-pipeline'
export { applyPreprocessingPipeline } from './preprocessing-pipeline'
