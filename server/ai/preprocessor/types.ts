/** Single desensitization rule */
export interface DesensitizeRule {
  /** Unique identifier (builtin rules use fixed ids, custom rules use uuid) */
  id: string
  /** Display label */
  label: string
  /** Regex pattern string (compiled at runtime with new RegExp(pattern, 'g')) */
  pattern: string
  /** Replacement text */
  replacement: string
  /** Whether enabled */
  enabled: boolean
  /** Whether this is a builtin rule (builtin rules can't be deleted, only toggled) */
  builtin: boolean
  /** Applicable locale list (empty array = universal) */
  locales: string[]
}

/** Preprocessing configuration */
export interface PreprocessConfig {
  /** Data cleaning: clean XML card messages etc. (enabled by default) */
  dataCleaning: boolean
  /** Merge consecutive messages (same sender + time interval < mergeWindowSeconds) */
  mergeConsecutive: boolean
  /** Merge window in seconds, default 180 */
  mergeWindowSeconds?: number
  /** Custom blacklist keywords; messages containing any keyword are filtered entirely */
  blacklistKeywords: string[]
  /** Smart denoise (filter pure interjections, pure emoji, system placeholders) */
  denoise: boolean
  /** Data desensitization master switch */
  desensitize: boolean
  /** Desensitization rules list (builtin + custom, ordered by priority) */
  desensitizeRules: DesensitizeRule[]
  /** Name anonymization: replace real nicknames with U{id} to reduce AI hallucination */
  anonymizeNames: boolean
}

/** Message structure accepted by the preprocessing pipeline */
export interface PreprocessableMessage {
  id?: number
  senderId?: number
  senderName: string
  senderPlatformId?: string
  content: string | null
  timestamp: number
  replyToMessageId?: string | null
}
