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
  GOOGLE_CHAT: 'google-chat',
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
  /**
   * The actual owner_id written to each updated session.
   * On name-match platforms the matched member's platformId can differ from
   * ownerId (the source session's platformId), so callers must use this map
   * rather than ownerId when caching the result for updated sessions.
   */
  updatedSessionOwnerIds: Record<string, string>
}

// ==================== Contacts (cross-session relationship view) ====================

export type ContactPool = 'friend' | 'non_friend'

export type ContactFriendSource = 'private' | 'manual'

export type ContactsCacheStatus = 'fresh' | 'stale' | 'missing'

export type ContactsTaskStatus = 'idle' | 'running' | 'succeeded' | 'failed' | 'superseded'

export const CONTACTS_TIME_RANGE_PRESETS = ['1y', '2y', '3y', '5y', 'all'] as const

export type ContactsTimeRangePreset = (typeof CONTACTS_TIME_RANGE_PRESETS)[number]

export interface ContactsTimeRangeState {
  preset: ContactsTimeRangePreset
  anchorTs: number | null
  startTs: number | null
}

export interface ContactScoreBreakdown {
  privateMessageScore?: number
  privateRegularityScore?: number
  commonGroupScore?: number
  coOccurrenceScore?: number
  replyInteractionScore?: number
  privateMessageCount?: number
  activePrivateMonths?: number
  commonGroupCount?: number
  coOccurrenceCount?: number
  coOccurrenceRawScore?: number
  replyInteractionCount?: number
  repliesFromOwnerToContact?: number
  repliesFromContactToOwner?: number
}

export interface ContactSourceSession {
  id: string
  name: string
  platform: ChatPlatform
  type: ChatType
  messageCount?: number
  privateMessageCount?: number
  coOccurrenceCount?: number
  coOccurrenceRawScore?: number
  replyInteractionCount?: number
  repliesFromOwnerToContact?: number
  repliesFromContactToOwner?: number
  lastMessageTs?: number | null
  lastInteractionTs?: number | null
}

export interface ContactItem {
  key: string
  platform: ChatPlatform
  platformId: string
  sessionScoped: boolean
  sessionId?: string
  displayName: string
  aliases: string[]
  avatar: string | null
  isFriend: boolean
  pool: ContactPool
  friendSource?: ContactFriendSource
  score: number
  scoreBreakdown: ContactScoreBreakdown
  sourceSessions: ContactSourceSession[]
  searchText: string
  lastInteractionTs: number | null
}

export type ContactListItem = Omit<ContactItem, 'sourceSessions' | 'searchText'>

export interface ContactsDiagnostics {
  privateSessionCount: number
  activePrivateSessionCount: number
  contactsEnabled: boolean
  skippedMissingOwnerSessions: number
  skippedUnresolvedOwnerSessions: number
  skippedAmbiguousPrivateSessions: number
  skippedInvalidPlatformIdMembers: number
  skippedFailedSessions: number
  warnings: string[]
}

export interface ContactsCacheState {
  status: ContactsCacheStatus
  computedAt: number | null
  signature?: string
  staleReason?: string
}

export interface ContactsTaskState {
  id: string | null
  status: ContactsTaskStatus
  startedAt: number | null
  finishedAt: number | null
  processedSessions: number
  totalSessions: number
  timeRangePreset?: ContactsTimeRangePreset
  currentSessionId?: string
  lastError?: string
}

export interface ContactsPagination {
  page: number
  pageSize: number
  total: number
  hasMore: boolean
}

export interface ContactsStats {
  friendsTotal: number
  nonFriendsTotal: number
}

export interface ContactsListResponse {
  contacts: ContactListItem[]
  diagnostics: ContactsDiagnostics
  cache: ContactsCacheState
  timeRange: ContactsTimeRangeState
  algorithmVersion: string
  pagination: ContactsPagination
  stats: ContactsStats
  task?: ContactsTaskState
}

export interface ContactDetailResponse {
  contact: ContactItem | null
  cache: ContactsCacheState
  timeRange: ContactsTimeRangeState
  algorithmVersion: string
  task?: ContactsTaskState
}

export type ContactsResponse = ContactsListResponse

// ==================== Global Insight ====================

export type AnnualSummaryMode = 'year' | 'recent'
export type AnnualSummaryCacheStatus = 'missing' | 'fresh' | 'stale'
export type AnnualSummaryTaskStatus = 'idle' | 'running' | 'succeeded' | 'failed' | 'superseded'

export interface AnnualSummaryRange {
  mode: AnnualSummaryMode
  year?: number
  days?: 365
  startTs: number
  endTs: number
}

export interface AnnualSummaryMetrics {
  sentMessageCount: number
  activeDayCount: number
  directContactCount: number
  averageMessagesPerDay: number
  averageDirectContactsPerDay: number
}

export interface AnnualSummaryCoverage {
  totalSessions: number
  analyzedSessions: number
  missingOwnerSessions: number
  unresolvedOwnerSessions: number
  failedSessions: number
}

export interface AnnualSummaryTextLength {
  textMessageCount: number
  median: number | null
  p90: number | null
  buckets: Array<{ key: string; count: number }>
}

export interface AnnualSummaryCacheState {
  status: AnnualSummaryCacheStatus
  computedAt: number | null
  signature?: string
  staleReason?: string
}

export interface AnnualSummaryTaskState {
  id: string | null
  status: AnnualSummaryTaskStatus
  startedAt: number | null
  finishedAt: number | null
  processedSessions: number
  totalSessions: number
  currentSessionId?: string
  lastError?: string
}

export interface AnnualSummaryResponse {
  range: AnnualSummaryRange
  availableDataYears: number[]
  latestDataYear: number | null
  metrics: AnnualSummaryMetrics | null
  monthlyActivity: Array<{ month: string; messageCount: number }>
  dailyActivity: Array<{ date: string; messageCount: number }>
  messageTypes: Array<{ type: number; count: number }>
  textLength: AnnualSummaryTextLength | null
  coverage: AnnualSummaryCoverage
  cache: AnnualSummaryCacheState
  task: AnnualSummaryTaskState
}

// ==================== People Relationships (galaxy graph) ====================

export type PeopleRelationshipsCacheStatus = ContactsCacheStatus
export type PeopleRelationshipsTaskStatus = ContactsTaskStatus
export type PeopleRelationshipsGraphScope = 'panorama' | 'close' | 'friends'

export interface PeopleRelationshipGraphNode {
  key: string
  kind?: 'contact' | 'owner'
  platform: ChatPlatform
  platformId: string
  sessionScoped: boolean
  sessionId?: string
  displayName: string
  aliases: string[]
  avatar: string | null
  pool: ContactPool
  friendSource?: ContactFriendSource
  score: number
  rank: number
  communityId: string
  x: number
  y: number
  size: number
  color: string
  labelVisibility: 0 | 1 | 2
  lastInteractionTs: number | null
  privateMessageCount: number
  groupMessageCount: number
  commonGroupCount: number
  searchText: string
}

export interface PeopleRelationshipGraphEdge {
  id: string
  sourceKey: string
  targetKey: string
  weight: number
  coOccurrenceCount: number
  coOccurrenceRawScore: number
  replyInteractionCount: number
  repliesFromSourceToTarget: number
  repliesFromTargetToSource: number
  sourceGroupCount: number
  sourceSessionIds: string[]
  lastInteractionTs: number | null
  visibility: 0 | 1 | 2
}

export interface PeopleRelationshipCommunity {
  id: string
  label: string
  size: number
  x: number
  y: number
  color: string
}

export interface PeopleRelationshipsGraphData {
  nodes: PeopleRelationshipGraphNode[]
  edges: PeopleRelationshipGraphEdge[]
  communities: PeopleRelationshipCommunity[]
}

export interface PeopleRelationshipsDiagnostics {
  processedPrivateSessions: number
  processedGroupSessions: number
  skippedMissingOwnerSessions: number
  skippedUnresolvedOwnerSessions: number
  skippedAmbiguousPrivateSessions: number
  skippedFailedSessions: number
  totalNodes: number
  totalEdges: number
  panoramaIncludedGroupSessions: number
  panoramaExcludedLowValueGroupSessions: number
  panoramaIncludedGroupMembers: number
  panoramaExcludedGroupMembers: number
  panoramaCandidateNodes: number
  panoramaGroupInclusionReasons: Record<string, number>
  coreNodeCount: number
  coreEdgeCount: number
  warnings: string[]
}

export interface PeopleRelationshipsCacheState {
  status: PeopleRelationshipsCacheStatus
  computedAt: number | null
  signature?: string
  staleReason?: string
}

export interface PeopleRelationshipsTaskState {
  id: string | null
  status: PeopleRelationshipsTaskStatus
  startedAt: number | null
  finishedAt: number | null
  processedSessions: number
  totalSessions: number
  timeRangePreset?: ContactsTimeRangePreset
  currentSessionId?: string
  lastError?: string
}

export interface PeopleRelationshipsSearchResult {
  key: string
  kind?: 'contact' | 'owner'
  displayName: string
  platform: ChatPlatform
  platformId: string
  avatar: string | null
  pool: ContactPool
  friendSource?: ContactFriendSource
  score: number
  rank: number
  communityId: string
  inCoreGraph: boolean
}

export interface PeopleRelationshipsGraphResponse {
  graph: PeopleRelationshipsGraphData
  searchResults: PeopleRelationshipsSearchResult[]
  diagnostics: PeopleRelationshipsDiagnostics
  cache: PeopleRelationshipsCacheState
  timeRange: ContactsTimeRangeState
  algorithmVersion: string
  task?: PeopleRelationshipsTaskState
}

export interface PeopleRelationshipsNeighborhoodResponse {
  contact: PeopleRelationshipGraphNode | null
  graph: PeopleRelationshipsGraphData
  diagnostics: PeopleRelationshipsDiagnostics
  cache: PeopleRelationshipsCacheState
  timeRange: ContactsTimeRangeState
  algorithmVersion: string
  task?: PeopleRelationshipsTaskState
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
