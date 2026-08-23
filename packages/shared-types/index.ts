/**
 * @openchatlab/shared-types
 * 平台无关的共享类型定义，三端（Electron / Node 服务 / Web）统一使用
 */

// ==================== Plugin identity ====================

/** Stable identity shared by the UI and Node facets of the built-in plugin. */
export const ANNUAL_SUMMARY_PLUGIN_ID = 'chatlab.insight.annual-summary'
export const TIME_INVESTMENT_PLUGIN_ID = 'chatlab.insight.time-investment'

// ==================== Navigation layout ====================

export const NAVIGATION_LAYOUT_SCHEMA_VERSION = 1 as const

export interface NavigationLayoutEntryItem {
  kind: 'entry'
  entryId: string
}

export interface NavigationLayoutGroupItem {
  kind: 'group'
  id: string
  /** User-authored override. Missing values use the host-localized group title. */
  title?: string
  /** Stable navigation entry IDs. Unknown IDs are intentionally preserved. */
  children: string[]
}

export type NavigationLayoutPrimaryItem = NavigationLayoutEntryItem | NavigationLayoutGroupItem

export interface NavigationLayout {
  schemaVersion: typeof NAVIGATION_LAYOUT_SCHEMA_VERSION
  primary: NavigationLayoutPrimaryItem[]
  hiddenEntryIds: string[]
}

export type NavigationLayoutLoadResult =
  | { status: 'saved'; layout: NavigationLayout }
  | { status: 'missing' | 'invalid'; layout: null }

// ==================== AI tool progress ====================

/** Stable, transport-safe progress payload emitted by long-running AI tools. */
export interface ToolProgress {
  phase: string
  current?: number
  total?: number
}

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

export type AIEntityRef =
  | {
      type: 'contact'
      contactKey: string
      displayName: string
    }
  | {
      type: 'session'
      sessionId: string
      displayName: string
      sessionType: 'private' | 'group'
    }

export {
  CHATLAB_FORMAT_VERSION,
  CHATLAB_SUPPORTED_FORMAT_VERSIONS,
  isSupportedChatLabFormatVersion,
  type ChatLabFormatVersion,
} from './chatlab-format'

// ==================== AI Assistants ====================

export const GENERAL_ASSISTANT_IDS = ['general_cn', 'general_tw', 'general_en', 'general_ja'] as const

export type GeneralAssistantId = (typeof GENERAL_ASSISTANT_IDS)[number]

export const DEFAULT_GENERAL_ASSISTANT_ID: GeneralAssistantId = 'general_cn'

export function getDefaultGeneralAssistantId(locale?: string): GeneralAssistantId {
  if (locale?.startsWith('zh-TW')) return 'general_tw'
  if (locale?.startsWith('en')) return 'general_en'
  if (locale?.startsWith('ja')) return 'general_ja'
  return DEFAULT_GENERAL_ASSISTANT_ID
}

export function isGeneralAssistantId(id: string): id is GeneralAssistantId {
  return GENERAL_ASSISTANT_IDS.some((generalId) => generalId === id)
}

export interface AssistantConfig {
  id: string
  name: string
  systemPrompt: string
  presetQuestions: string[]
  allowedBuiltinTools?: string[]
  builtinId?: string
  /** Builtin template version this config was based on, used only for safe upgrades. */
  builtinVersion?: number
  /** Digest of the source builtin template; remains unchanged after user edits. */
  builtinDigest?: string
  applicableChatTypes?: ('group' | 'private')[]
  supportedLocales?: string[]
}

export interface AssistantSummary {
  id: string
  name: string
  systemPrompt: string
  presetQuestions: string[]
  builtinId?: string
  applicableChatTypes?: ('group' | 'private')[]
  supportedLocales?: string[]
}

export interface BuiltinAssistantInfo {
  id: string
  name: string
  systemPrompt: string
  applicableChatTypes?: ('group' | 'private')[]
  supportedLocales?: string[]
  imported: boolean
}

export interface AssistantUpgradeInfo {
  assistantId: string
  builtinId: string
  name: string
  currentVersion: number | null
  latestVersion: number | null
}

export interface AssistantUpgradeResult {
  success: boolean
  backupId?: string
  error?: string
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
  aliases?: string[]
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

export type ChartAutoMode = 'explicit' | 'suggest' | 'aggressive'

export type {
  ChatTopic,
  ChatTopicAssignmentMode,
  ChatTopicDay,
  ChatTopicDayStatus,
  ChatTopicEvidence,
  ChatTopicPreflight,
  ChatTopicPreflightDay,
  ChatTopicRangeKind,
  ChatTopicRun,
  ChatTopicRunRangeKind,
  ChatTopicRunStatus,
  ChatTopicTimeRange,
  CreateChatTopicsRequest,
} from './chat-topics'

export interface AIGlobalSettings {
  maxMessagesPerRequest: number
  exportFormat: 'markdown' | 'txt'
  sqlExportFormat: 'csv' | 'json'
  enableAutoSkill: boolean
  chartAutoMode: ChartAutoMode
  searchContextBefore: number
  searchContextAfter: number
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

export type ApplyOwnerProfileReason =
  | 'no_profile'
  | 'no_match'
  | 'ambiguous'
  | 'already_set'
  | 'missing_session'
  | 'excluded'

export interface ApplyOwnerProfileResult {
  applied: boolean
  ownerId?: string
  reason?: ApplyOwnerProfileReason
  /** Whether the user confirmed that their own messages are absent from this session. */
  excluded: boolean
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

// ==================== Cross-chat AI analysis ====================

export interface CrossChatSessionDescriptor {
  sessionId: string
  sessionName: string
  sessionType: ChatType
  platform: ChatPlatform
  lastMessageTs: number | null
}

export interface CrossChatResolvedContactSession extends CrossChatSessionDescriptor {
  memberId: number
  memberPlatformId: string
  memberName: string
}

export interface CrossChatContactCandidate {
  contactKey: string
  displayName: string
  platform: ChatPlatform
  aliases: string[]
  sourceSessions: Array<{
    id: string
    name: string
    type: ChatType
  }>
}

export interface CrossChatContactLookupResult {
  query: string
  status: 'resolved' | 'ambiguous' | 'not_found' | 'unavailable'
  cacheStatus: ContactsCacheStatus
  totalCandidates: number
  candidates: CrossChatContactCandidate[]
}

export interface CrossChatResolvedContact {
  ref: Extract<AIEntityRef, { type: 'contact' }>
  status: 'resolved' | 'partial' | 'unresolved'
  cacheStatus: ContactsCacheStatus
  sessions: CrossChatResolvedContactSession[]
  unresolvedSessionIds: string[]
  failedSessionIds: string[]
}

export interface CrossChatResolvedSession {
  ref: Extract<AIEntityRef, { type: 'session' }>
  status: 'resolved' | 'unresolved'
  session?: CrossChatSessionDescriptor
}

export interface CrossChatUnresolvedEntity {
  ref: AIEntityRef
  reason: 'contact_snapshot_missing' | 'contact_not_found' | 'session_not_found' | 'member_not_found'
}

export interface CrossChatEntityResolution {
  contacts: CrossChatResolvedContact[]
  sessions: CrossChatResolvedSession[]
  unresolved: CrossChatUnresolvedEntity[]
  coverage: {
    requestedEntities: number
    resolvedEntities: number
    candidateSessions: number
    resolvedSessions: number
    failedSessions: number
  }
}

export interface CrossChatSearchScope {
  sessionId: string
  memberIds?: number[]
  label?: string
}

export interface CrossChatSearchRequest {
  keywords: string[]
  scopes?: CrossChatSearchScope[]
  startTs?: number
  endTs?: number
  recentDays?: number
  sender?: 'all' | 'owner'
  matchMode?: 'any' | 'all'
  sort?: 'asc' | 'desc'
  maxSessions?: number
  maxEvidence?: number
  maxWallTimeMs?: number
}

export interface CrossChatSearchProgress {
  processedSessions: number
  totalSessions: number
  currentSessionId?: string
}

export interface CrossChatOperationOptions {
  signal?: AbortSignal
  onProgress?: (progress: CrossChatSearchProgress) => void
}

export interface CrossChatMessageSource extends CrossChatSessionDescriptor {
  messageId: number
  senderId: number
  senderName: string
  senderPlatformId: string
  content: string
  timestamp: number
  messageType: number
  /** Whether this row directly matched the search or was loaded as surrounding context. */
  evidenceRole?: 'match' | 'context'
}

export type CrossChatTruncationReason = 'session_budget' | 'evidence_budget' | 'time_budget'

export interface CrossChatSearchResult {
  messages: CrossChatMessageSource[]
  totalMatches: number
  appliedFilters: {
    startTs: number | null
    endTs: number | null
    recentDays: number | null
    sender: 'all' | 'owner'
  }
  coverage: {
    candidateSessions: number
    scannedSessions: number
    matchedSessions: number
    failedSessions: number
    ownerResolution?: {
      resolvedSessions: number
      missingOwnerSessions: number
      unresolvedOwnerSessions: number
    }
    truncated: boolean
    truncatedReasons: CrossChatTruncationReason[]
  }
}

export interface CrossChatRecentSessionSummary {
  segmentId: number
  startTs: number
  endTs: number
  messageCount: number
  participants: string[]
  summary: string
}

export interface CrossChatRecentSessionResult {
  source: CrossChatSessionDescriptor
  messages: CrossChatMessageSource[]
  summaries: CrossChatRecentSessionSummary[]
  coverage: {
    totalMessages: number
    returnedMessages: number
    returnedSummaries: number
    hasEarlierMessages: boolean
  }
}

export interface CrossChatMessageContextRequest {
  sessionId: string
  messageId: number
  contextSize?: number
}

export interface CrossChatMessageContextResult {
  source: CrossChatSessionDescriptor
  messages: CrossChatMessageSource[]
}

export interface CrossChatOverviewRequest {
  scopes: CrossChatSearchScope[]
  startTs?: number
  endTs?: number
  recentDays?: number
  maxSessions?: number
  maxWallTimeMs?: number
}

export interface CrossChatOverviewMemberActivity {
  memberId: number
  platformId: string
  memberName: string
  messageCount: number
  activeDays: number
  firstMessageTs: number | null
  lastMessageTs: number | null
}

export interface CrossChatOverviewItem extends CrossChatSessionDescriptor {
  label: string
  memberIds?: number[]
  memberNames?: string[]
  memberActivities: CrossChatOverviewMemberActivity[]
  totalMessages: number
  activeDays: number
  activeMembers: number
  firstMessageTs: number | null
  lastMessageTs: number | null
  ownerStatus: CrossChatOwnerStatus
  ownerMessages: number | null
  ownerActiveDays: number | null
  topMembers: CrossChatOverviewMemberActivity[]
}

export interface CrossChatOverviewResult {
  appliedRange: CrossChatStatisticsTimeRange
  items: CrossChatOverviewItem[]
  coverage: {
    candidateSessions: number
    analyzedSessions: number
    excludedSessions: number
    missingOwnerSessions: number
    unresolvedOwnerSessions: number
    failedSessions: number
    failedSessionIds: string[]
    complete: boolean
    truncated: boolean
    truncatedReasons: Array<'session_budget' | 'time_budget'>
  }
}

export interface CrossChatStatisticsTimeRange extends CrossChatInspectionTimeRange {
  currentTs: number
}

export type CrossChatPrivateContactsRankBy = 'message_count' | 'active_days'

export interface CrossChatPrivateContactsRankingRequest {
  startTs?: number
  endTs?: number
  recentDays?: number
  rankBy?: CrossChatPrivateContactsRankBy
  limit?: number
}

export interface CrossChatPrivateContactRankItem {
  rank: number
  contactKey: string
  displayName: string
  platform: ChatPlatform
  totalMessages: number
  ownerMessages: number
  contactMessages: number
  activeDays: number
  firstMessageTs: number | null
  lastMessageTs: number | null
  sessionIds: string[]
}

export interface CrossChatPrivateContactsRankingResult {
  algorithmVersion: string
  rankBy: CrossChatPrivateContactsRankBy
  appliedRange: CrossChatStatisticsTimeRange
  items: CrossChatPrivateContactRankItem[]
  coverage: {
    candidateSessions: number
    scannedSessions: number
    analyzedSessions: number
    excludedSessions: number
    missingOwnerSessions: number
    unresolvedOwnerSessions: number
    missingContactSessions: number
    ambiguousContactSessions: number
    failedSessions: number
    failedSessionIds: string[]
    complete: boolean
    truncated: boolean
    truncatedReasons: Array<'time_budget'>
  }
}

export type CrossChatGroupRankingMode = 'owner_activity' | 'total_activity'
export type CrossChatOwnerStatus = 'resolved' | 'missing' | 'unresolved' | 'excluded'

export interface CrossChatGroupSessionsRankingRequest {
  mode: CrossChatGroupRankingMode
  startTs?: number
  endTs?: number
  recentDays?: number
  limit?: number
}

export interface CrossChatGroupSessionRankItem extends CrossChatSessionDescriptor {
  rank: number
  totalMessages: number
  ownerMessages: number | null
  ownerMessageShare: number | null
  ownerActiveDays: number | null
  activeMembers: number
  activeDays: number
  firstMessageTs: number | null
  ownerStatus: CrossChatOwnerStatus
}

export interface CrossChatGroupSessionsRankingResult {
  algorithmVersion: string
  mode: CrossChatGroupRankingMode
  appliedRange: CrossChatStatisticsTimeRange
  items: CrossChatGroupSessionRankItem[]
  coverage: {
    candidateSessions: number
    scannedSessions: number
    analyzedSessions: number
    excludedSessions: number
    missingOwnerSessions: number
    unresolvedOwnerSessions: number
    failedSessions: number
    failedSessionIds: string[]
    complete: boolean
    truncated: boolean
    truncatedReasons: Array<'time_budget'>
  }
}

export type CrossChatParticipantRef =
  | { type: 'owner' }
  | {
      type: 'contact'
      contactKey: string
    }

export interface CrossChatInspectionTimeRange {
  startTs: number | null
  endTs: number | null
  dataEarliestMessageTs: number | null
  dataLatestMessageTs: number | null
}

export type CrossChatInspectionTruncationReason = 'page_size' | 'time_budget' | 'message_budget' | 'tool_result_budget'

export interface CrossChatInspectionCoverage {
  candidateSessions: number
  scannedSessions: number
  matchedSessions: number
  returnedSessions: number
  failedSessions: number
  failedSessionIds: string[]
  complete: boolean
  nextCursor: string | null
  truncated: boolean
  truncatedReasons: CrossChatInspectionTruncationReason[]
}

export interface CrossChatContactSessionsRequest {
  contactKey: string
  startTs?: number
  endTs?: number
  recentDays?: number
  includeRosterOnly?: boolean
  cursor?: string
  pageSize?: number
  maxWallTimeMs?: number
}

export interface CrossChatContactSessionItem extends CrossChatSessionDescriptor {
  memberId: number
  memberName: string
  presence: 'spoke' | 'roster_only'
  presenceObservedInRange: boolean
  ownMessageCount: number
  sessionMessageCount: number
  messageShare: number | null
  firstOwnMessageTs: number | null
  lastOwnMessageTs: number | null
  activeDays: number
  memberCount: number | null
  sessionFirstMessageTs: number | null
}

export interface CrossChatContactSessionsResult {
  algorithmVersion: string
  contact: {
    contactKey: string
    displayName: string
    platform: ChatPlatform
    sessionScoped: boolean
  } | null
  appliedRange: CrossChatInspectionTimeRange
  summary: {
    scope: 'current_batch' | 'complete_result'
    matchedSessions: number
    privateSessions: number
    groupSessions: number
    spokeSessions: number
    rosterOnlySessions: number
    ownMessageCount: number
    firstOwnMessageTs: number | null
    lastOwnMessageTs: number | null
  }
  sessions: CrossChatContactSessionItem[]
  coverage: CrossChatInspectionCoverage & {
    contactCacheStatus: ContactsCacheStatus
  }
}

export interface CrossChatSharedInteractionsRequest {
  participants: CrossChatParticipantRef[]
  startTs?: number
  endTs?: number
  recentDays?: number
  cursor?: string
  pageSize?: number
  maxAnchorsPerPair?: number
  maxWallTimeMs?: number
}

export interface CrossChatInspectionParticipant {
  index: number
  ref: CrossChatParticipantRef
  status: 'resolved' | 'unresolved'
  displayName: string
  platform?: ChatPlatform
  cacheStatus?: ContactsCacheStatus
}

export interface CrossChatParticipantSessionStats {
  participantIndex: number
  memberId: number
  memberName: string
  messageCount: number
  firstMessageTs: number | null
  lastMessageTs: number | null
  activeDays: number
  presenceObservedInRange: boolean
}

export interface CrossChatMessageAnchor {
  sessionId: string
  messageId: number
  relatedMessageId?: number
  timestamp: number
  signal: 'direct_reply' | 'proximity'
  fromParticipantIndex: number
  toParticipantIndex: number
}

export interface CrossChatParticipantPairFacts {
  sourceParticipantIndex: number
  targetParticipantIndex: number
  directReplyCount: number
  repliesFromSourceToTarget: number
  repliesFromTargetToSource: number
  lastDirectReplyTs: number | null
  coOccurrenceCount: number | null
  coOccurrenceRawScore: number | null
  lastProximityTs: number | null
  coActiveDays: number
  anchors: CrossChatMessageAnchor[]
  anchorsTruncated: boolean
}

export interface CrossChatSharedInteractionSessionItem extends CrossChatSessionDescriptor {
  memberCount: number | null
  participants: CrossChatParticipantSessionStats[]
  overlapRange: {
    startTs: number
    endTs: number
  } | null
  allParticipantsCoActiveDays: number
  pairs: CrossChatParticipantPairFacts[]
  priorityReasons: Array<'has_direct_reply' | 'has_proximity' | 'all_participants_spoke'>
  proximityStatus: 'complete' | 'partial' | 'skipped_budget'
}

export interface CrossChatSharedInteractionsResult {
  algorithmVersion: string
  proximityAlgorithmVersion: string
  participants: CrossChatInspectionParticipant[]
  appliedRange: CrossChatInspectionTimeRange
  summary: {
    scope: 'current_batch' | 'complete_result'
    commonSessions: number
    commonPrivateSessions: number
    commonGroupSessions: number
    sessionsWithDirectReplies: number
    sessionsWithProximitySignals: number
  }
  sessions: CrossChatSharedInteractionSessionItem[]
  coverage: CrossChatInspectionCoverage & {
    unresolvedParticipantIndexes: number[]
    identityCollisionSessions: number
    ownerResolution?: {
      resolvedSessions: number
      missingOwnerSessions: number
      unresolvedOwnerSessions: number
    }
  }
}

export interface CrossChatEvidenceSource {
  sessionId: string
  sessionName: string
  sessionType: ChatType
  platform: ChatPlatform
  messageId: number
  senderName: string
  timestamp: number
  snippet: string
}

export interface CrossChatEvidencePayload {
  version: 1
  query: string
  sources: CrossChatEvidenceSource[]
  coverage: CrossChatSearchResult['coverage']
}

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
  monthlyDirectContacts: Array<{ month: string; contactCount: number }>
  dailyActivity: Array<{ date: string; messageCount: number }>
  messageTypes: Array<{ type: number; count: number }>
  textLength: AnnualSummaryTextLength | null
  coverage: AnnualSummaryCoverage
  cache: AnnualSummaryCacheState
  task: AnnualSummaryTaskState
}

export interface TimeInvestmentMetrics {
  estimatedSeconds: number
  activeDayCount: number
  averagePerActiveDaySeconds: number
}

export interface TimeInvestmentActivityPoint {
  key: string
  estimatedSeconds: number
}

export interface TimeInvestmentSessionRankItem {
  sessionId: string
  name: string
  platform: ChatPlatform
  type: ChatType
  seconds: number
  share: number
}

export interface TimeInvestmentChatTypeItem {
  type: ChatType
  seconds: number
  share: number
}

export interface TimeInvestmentResponse {
  range: AnnualSummaryRange
  availableDataYears: number[]
  latestDataYear: number | null
  metrics: TimeInvestmentMetrics | null
  monthlyActivity: TimeInvestmentActivityPoint[]
  dailyActivity: TimeInvestmentActivityPoint[]
  sessionRanking: TimeInvestmentSessionRankItem[]
  chatTypes: TimeInvestmentChatTypeItem[]
  coverage: AnnualSummaryCoverage
  cache: AnnualSummaryCacheState
  task: AnnualSummaryTaskState
}

// ==================== People Relationships (galaxy graph) ====================

/**
 * 关系星系渲染器的最小契约。
 *
 * People 跨会话关系和群聊单会话关系都可以映射到该结构，渲染层不应依赖
 * 好友池、共同群等任一业务场景的专属字段。
 */
export interface RelationshipGalaxyRenderNode {
  key: string
  displayName: string
  avatar: string | null
  score: number
  rank: number
  communityId: string
  x: number
  y: number
  size: number
  color: string
  labelVisibility: 0 | 1 | 2
  visualRole?: 'anchor' | 'close' | 'standard'
  importance?: number
}

export interface RelationshipGalaxyRenderEdge {
  id: string
  sourceKey: string
  targetKey: string
  weight: number
  visibility: 0 | 1 | 2
  lastInteractionTs?: number | null
}

export interface RelationshipGalaxyRenderCommunity {
  id: string
  label: string
  size: number
  x: number
  y: number
  color: string
}

export interface RelationshipGalaxyRenderGraph {
  nodes: RelationshipGalaxyRenderNode[]
  edges: RelationshipGalaxyRenderEdge[]
  communities: RelationshipGalaxyRenderCommunity[]
}

export interface GroupRelationshipGalaxyMemberDetail {
  key: string
  memberId: number
  platformId: string
  displayName: string
  avatar: string | null
  messageCount: number
  lastMessageTs: number | null
  relationshipScore: number
  rank: number
  communityId: string
  replyInteractionCount: number
  mentionInteractionCount: number
  coOccurrenceCount: number
  coOccurrenceRawScore: number
  lastInteractionTs: number | null
}

export interface GroupRelationshipGalaxyEdgeDetail {
  id: string
  sourceKey: string
  targetKey: string
  weight: number
  coOccurrenceCount: number
  coOccurrenceRawScore: number
  replyInteractionCount: number
  mentionInteractionCount: number
  lastInteractionTs: number | null
}

export interface GroupRelationshipGalaxyData {
  graph: RelationshipGalaxyRenderGraph
  members: GroupRelationshipGalaxyMemberDetail[]
  edges: GroupRelationshipGalaxyEdgeDetail[]
  stats: {
    totalMembers: number
    activeMembers: number
    displayedMembers: number
    displayedEdges: number
    communityCount: number
  }
  algorithmVersion: string
}

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
  /** Builtin assistant versions the user chose to skip, keyed by builtin assistant ID. */
  assistantUpgradeSkippedVersions: Record<string, number>
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
  /** Sessions confirmed not to contain the user; excluded from owner-dependent insights. */
  ownerExcludedSessionIds: string[]
}

export interface UiConfig {
  default_session_tab: 'insights' | 'ai-chat'
  session_gap_threshold: number
  summary_strategy?: 'brief' | 'standard'
}

export type DesktopCloseBehavior = 'background' | 'quit'

// ==================== 匿名使用统计 ====================

export type AnalyticsAppType = 'desktop' | 'cli' | 'cli_web' | 'web_wasm'

export type AnalyticsEventName =
  | 'app_started'
  | 'app_active_new'
  | 'app_active'
  | 'chat_import_started'
  | 'chat_import_completed'
  | 'chat_import_failed'
  | 'incremental_import_used'
  | 'feature_used'
  | 'ai_setup_completed'
  | 'ai_request_started'
  | 'ai_request_completed'

export type AnalyticsPropertyValue = string | number | boolean
