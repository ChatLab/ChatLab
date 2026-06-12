/**
 * @openchatlab/shared-types
 * 平台无关的共享类型定义，三端（Electron / Node 服务 / Web）统一使用
 */

// ==================== 时间筛选 ====================

export interface TimeFilter {
  startTs?: number
  endTs?: number
  memberId?: number | null
}

// ==================== 枚举与平台 ====================

/**
 * 消息类型枚举
 *
 * 分类说明：
 * - 基础消息 (0-19): 常见的内容类型
 * - 交互消息 (20-39): 涉及互动的消息类型
 * - 系统消息 (80-89): 系统相关消息
 * - 其他 (99): 未知或无法分类的消息
 */
export enum MessageType {
  // ========== 基础消息类型 (0-19) ==========
  TEXT = 0,
  IMAGE = 1,
  VOICE = 2,
  VIDEO = 3,
  FILE = 4,
  EMOJI = 5,
  LINK = 7,
  LOCATION = 8,

  // ========== 交互消息类型 (20-39) ==========
  RED_PACKET = 20,
  TRANSFER = 21,
  POKE = 22,
  CALL = 23,
  SHARE = 24,
  REPLY = 25,
  FORWARD = 26,
  CONTACT = 27,

  // ========== 系统消息类型 (80-89) ==========
  SYSTEM = 80,
  RECALL = 81,

  // ========== 其他 (99) ==========
  OTHER = 99,
}

/**
 * 聊天平台类型（字符串，允许任意值）
 * 常见平台示例：qq, weixin, discord, whatsapp 等
 * 合并多平台记录时使用 'mixed'
 */
export type ChatPlatform = string

export const KNOWN_PLATFORMS = {
  QQ: 'qq',
  WECHAT: 'weixin',
  DISCORD: 'discord',
  WHATSAPP: 'whatsapp',
  TELEGRAM: 'telegram',
  INSTAGRAM: 'instagram',
  LINE: 'line',
  UNKNOWN: 'unknown',
} as const

/**
 * 聊天类型枚举
 */
export enum ChatType {
  GROUP = 'group',
  PRIVATE = 'private',
}

// ==================== 成员角色 ====================

export interface MemberRole {
  id: string
  name?: string
}

export const STANDARD_ROLE_IDS = {
  OWNER: 'owner',
  ADMIN: 'admin',
} as const

// ==================== 标准协议（Parser 输出） ====================

export interface ParsedMember {
  platformId: string
  accountName: string
  groupNickname?: string
  avatar?: string
  roles?: MemberRole[]
}

export interface ParsedMessage {
  platformMessageId?: string
  senderPlatformId: string
  senderAccountName: string
  senderGroupNickname?: string
  timestamp: number
  type: MessageType
  content: string | null
  replyToMessageId?: string
}

// ==================== Preferences (跨端偏好设置) ====================

export interface WordFilterScheme {
  id: string
  name: string
  words: string[]
  createdAt: number
}

export interface ContextCompressionSettings {
  enabled: boolean
  tokenThresholdPercent: number
  bufferSizePercent: number
  maxToolResultPercent: number
}

export type ChartAutoMode = 'explicit' | 'suggest' | 'aggressive'

export interface AIGlobalSettings {
  maxMessagesPerRequest: number
  exportFormat: 'markdown' | 'txt'
  sqlExportFormat: 'csv' | 'json'
  enableAutoSkill: boolean
  chartAutoMode: ChartAutoMode
  searchContextBefore: number
  searchContextAfter: number
  contextCompression: ContextCompressionSettings
}

export interface KeywordTemplate {
  id: string
  name: string
  keywords: string[]
  [key: string]: unknown
}

export interface DesensitizeRule {
  id: string
  label: string
  pattern: string
  replacement: string
  enabled: boolean
  builtin: boolean
  locales: string[]
  group?: string
}

export interface AIPreprocessConfig {
  dataCleaning: boolean
  mergeConsecutive: boolean
  mergeWindowSeconds: number
  blacklistKeywords: string[]
  denoise: boolean
  desensitize: boolean
  desensitizeRulesSchemaVersion?: number
  desensitizeBuiltinRuleOverrides?: Record<string, boolean>
  desensitizeRules: DesensitizeRule[]
  anonymizeNames: boolean
}

export interface FilterHistoryItem {
  id: string
  sessionId: string
  createdAt: number
  name: string
  mode: 'condition' | 'session'
  conditionFilter?: {
    keywords: string[]
    timeRange: { start: number; end: number } | null
    senderIds: number[]
    contextSize: number
  }
  selectedSessionIds?: number[]
}

export type OwnerMatchMode = 'platform_id' | 'name'

/**
 * Platform-level owner identity ("who am I" on this chat platform).
 * Stored in preferences.json and shared across sessions of the same platform.
 */
export interface OwnerProfile {
  platformId: string
  displayName: string
  /** Original (non-normalized) names confirmed by the user; normalization happens at match time. */
  confirmedNames: string[]
  matchMode: OwnerMatchMode
  updatedAt: number
}

export type ApplyOwnerProfileReason = 'no_profile' | 'no_match' | 'ambiguous' | 'already_set' | 'missing_session'

export interface ApplyOwnerProfileResult {
  applied: boolean
  ownerId?: string
  reason?: ApplyOwnerProfileReason
  /** Whether the user chose "do not remind me" for this session (UI hint only). */
  dismissed: boolean
}

export interface SetOwnerAndApplyProfileResult {
  sessionId: string
  platform: string
  ownerId: string
  /** Other same-platform sessions auto-filled by the updated profile. */
  updatedSessionIds: string[]
}

export interface Preferences {
  pinnedSessionIds: string[]
  aiPreprocessConfig: AIPreprocessConfig
  aiGlobalSettings: AIGlobalSettings
  customKeywordTemplates: KeywordTemplate[]
  deletedPresetTemplateIds: string[]
  wordFilter: {
    schemes: WordFilterScheme[]
    defaultSchemeId: string | null
    sessionSchemeOverrides: Record<string, string | null>
  }
  filterHistory: FilterHistoryItem[]
  /** Per-model thinking level, keyed by `${configId}:${modelId}`. */
  thinkingLevels: Record<string, string>
  /** Platform-level owner identity, keyed by platform (e.g. 'whatsapp'). */
  ownerProfilesByPlatform: Record<string, OwnerProfile>
  /** Sessions where the user chose "do not remind me"; suppresses the owner prompt UI only. */
  ownerPromptDismissedSessionIds: string[]
}

export interface UiConfig {
  default_session_tab: 'overview' | 'ai-chat'
  session_gap_threshold: number
  summary_strategy?: 'brief' | 'standard'
}
