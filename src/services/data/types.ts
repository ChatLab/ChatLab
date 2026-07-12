/**
 * DataAdapter — 数据查询领域的适配器接口
 *
 * 涵盖：会话管理、统计分析、成员管理、社交分析、SQL Lab、通用 SQL 查询
 * Electron 通过 window.chatApi IPC 实现，Web 通过 /_web/ HTTP API 实现。
 */

import type { AnalysisSession, MessageType } from '@/types/base'
import type {
  TimeFilter,
  ApplyOwnerProfileResult,
  SetOwnerAndApplyProfileResult,
  ContactsResponse,
  ContactDetailResponse,
  ContactPool,
  ContactsTimeRangePreset,
  PeopleRelationshipsGraphScope,
  PeopleRelationshipsGraphResponse,
  PeopleRelationshipsNeighborhoodResponse,
  AnnualSummaryMode,
  AnnualSummaryResponse,
} from '@openchatlab/shared-types'
import type {
  MemberActivity,
  MemberWithStats,
  MemberNameHistory,
  HourlyActivity,
  DailyActivity,
  WeekdayActivity,
  MonthlyActivity,
  CatchphraseAnalysis,
  MentionAnalysis,
  LaughAnalysis,
  ClusterGraphData,
  ClusterGraphOptions,
  RelationshipStats,
} from '@/types/analysis'
import type { LanguagePreferenceResult } from '@/types/quotes/languagePreference'
import type {
  TextStats,
  TextLengthPercentiles,
  MemberMonthlyTrend,
  DragonKingAnalysis,
  DivingAnalysis,
  CheckInAnalysis,
  MemeBattleAnalysis,
  NightOwlAnalysis,
  RepeatAnalysis,
} from '@openchatlab/core'

// ==================== 分页参数与结果 ====================

export interface PaginationParams {
  page: number
  pageSize: number
  search?: string
  sortOrder?: 'asc' | 'desc'
}

export interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// ==================== SQL Lab 结果 ====================

export interface SQLResult {
  columns: string[]
  rows: unknown[][]
  rowCount: number
  duration: number
  limited: boolean
}

export interface TableSchema {
  name: string
  columns: Array<{
    name: string
    type: string
    notnull: boolean
    pk: boolean
  }>
}

// ==================== Contacts ====================

export interface ContactsFetchOptions {
  acceptStale?: boolean
  timeRangePreset?: ContactsTimeRangePreset
  pool?: ContactPool
  page?: number
  pageSize?: number
  query?: string
}

export interface ContactsRecomputeOptions {
  timeRangePreset?: ContactsTimeRangePreset
  pool?: ContactPool
  page?: number
  pageSize?: number
  query?: string
}

export interface ContactFriendMarkOptions {
  timeRangePreset?: ContactsTimeRangePreset
}

// ==================== People Relationships ====================

export interface PeopleRelationshipsFetchOptions {
  acceptStale?: boolean
  timeRangePreset?: ContactsTimeRangePreset
  graphScope?: PeopleRelationshipsGraphScope
  query?: string
}

export interface PeopleRelationshipsRecomputeOptions {
  timeRangePreset?: ContactsTimeRangePreset
  graphScope?: PeopleRelationshipsGraphScope
  query?: string
}

// ==================== Global Insight ====================

export interface AnnualSummaryFetchOptions {
  mode?: AnnualSummaryMode
  year?: number
  days?: 365
  acceptStale?: boolean
}

// ==================== Mention Graph ====================

export interface MentionGraphData {
  nodes: Array<{ id: number; name: string; value: number; symbolSize: number }>
  links: Array<{ source: string; target: string; value: number }>
  maxLinkValue: number
}

// ==================== 消息长度分布 ====================

export interface MessageLengthDistribution {
  detail: Array<{ len: number; count: number }>
  grouped: Array<{ range: string; count: number }>
}

// ==================== 核心接口 ====================

export interface DataAdapter {
  // ==================== 会话管理 ====================

  getSessions(): Promise<AnalysisSession[]>
  getSession(sessionId: string): Promise<AnalysisSession | null>
  deleteSession(sessionId: string): Promise<boolean>
  renameSession(sessionId: string, newName: string): Promise<boolean>
  updateSessionOwnerId(sessionId: string, ownerId: string | null): Promise<boolean>
  tryApplyOwnerProfile(sessionId: string): Promise<ApplyOwnerProfileResult>
  setOwnerAndApplyProfile(sessionId: string, ownerPlatformId: string): Promise<SetOwnerAndApplyProfileResult>
  dismissOwnerPrompt(sessionId: string): Promise<boolean>

  // ==================== 联系人 ====================

  getContacts(options?: ContactsFetchOptions): Promise<ContactsResponse>
  getContactDetail(key: string, options?: ContactsFetchOptions): Promise<ContactDetailResponse>
  recomputeContacts(options?: ContactsRecomputeOptions): Promise<ContactsResponse>
  markContactAsFriend(key: string, options?: ContactFriendMarkOptions): Promise<boolean>
  unmarkContactAsFriend(key: string, options?: ContactFriendMarkOptions): Promise<boolean>

  // ==================== 关系图谱 ====================

  getPeopleRelationships(options?: PeopleRelationshipsFetchOptions): Promise<PeopleRelationshipsGraphResponse>
  recomputePeopleRelationships(options?: PeopleRelationshipsRecomputeOptions): Promise<PeopleRelationshipsGraphResponse>
  getPeopleRelationshipNeighborhood(
    key: string,
    options?: PeopleRelationshipsFetchOptions
  ): Promise<PeopleRelationshipsNeighborhoodResponse>

  // ==================== 全局洞察 ====================

  getAnnualSummary(options?: AnnualSummaryFetchOptions): Promise<AnnualSummaryResponse>
  recomputeAnnualSummary(options?: AnnualSummaryFetchOptions): Promise<AnnualSummaryResponse>

  // ==================== 时间范围 ====================

  getAvailableYears(sessionId: string): Promise<number[]>
  getTimeRange(sessionId: string): Promise<{ start: number; end: number } | null>

  // ==================== 统计分析 ====================

  getMemberActivity(sessionId: string, filter?: TimeFilter): Promise<MemberActivity[]>
  getHourlyActivity(sessionId: string, filter?: TimeFilter): Promise<HourlyActivity[]>
  getDailyActivity(sessionId: string, filter?: TimeFilter): Promise<DailyActivity[]>
  getWeekdayActivity(sessionId: string, filter?: TimeFilter): Promise<WeekdayActivity[]>
  getMonthlyActivity(sessionId: string, filter?: TimeFilter): Promise<MonthlyActivity[]>
  getYearlyActivity(sessionId: string, filter?: TimeFilter): Promise<Array<{ year: number; messageCount: number }>>
  getMessageLengthDistribution(sessionId: string, filter?: TimeFilter): Promise<MessageLengthDistribution>
  getMessageTypeDistribution(
    sessionId: string,
    filter?: TimeFilter
  ): Promise<Array<{ type: MessageType; count: number }>>
  getTextStats(sessionId: string, filter?: TimeFilter): Promise<TextStats>
  getLongMessageCount(sessionId: string, filter?: TimeFilter, minLength?: number): Promise<number>
  getMemberMonthlyTrend(sessionId: string, filter?: TimeFilter): Promise<MemberMonthlyTrend[]>
  getTextLengthPercentiles(sessionId: string, filter?: TimeFilter): Promise<TextLengthPercentiles>
  getDragonKingAnalysis(sessionId: string, filter?: TimeFilter): Promise<DragonKingAnalysis>
  getDivingAnalysis(sessionId: string, filter?: TimeFilter): Promise<DivingAnalysis>
  getCheckInAnalysis(sessionId: string, filter?: TimeFilter): Promise<CheckInAnalysis>
  getMemeBattleAnalysis(sessionId: string, filter?: TimeFilter): Promise<MemeBattleAnalysis>
  getNightOwlAnalysis(sessionId: string, filter?: TimeFilter): Promise<NightOwlAnalysis>
  getRepeatAnalysis(sessionId: string, filter?: TimeFilter): Promise<RepeatAnalysis>

  // ==================== 成员管理 ====================

  getMembers(sessionId: string): Promise<MemberWithStats[]>
  getMembersPaginated(sessionId: string, params: PaginationParams): Promise<PaginatedResult<MemberWithStats>>
  getMemberNameHistory(sessionId: string, memberId: number): Promise<MemberNameHistory[]>
  updateMemberAliases(sessionId: string, memberId: number, aliases: string[]): Promise<boolean>
  mergeMembers(sessionId: string, memberId1: number, memberId2: number): Promise<boolean>
  deleteMember(sessionId: string, memberId: number): Promise<boolean>

  // ==================== 社交分析 ====================

  getCatchphraseAnalysis(sessionId: string, filter?: TimeFilter): Promise<CatchphraseAnalysis>
  getLanguagePreferenceAnalysis(
    sessionId: string,
    locale: string,
    filter?: TimeFilter,
    dictType?: string
  ): Promise<LanguagePreferenceResult>
  getMentionAnalysis(sessionId: string, filter?: TimeFilter): Promise<MentionAnalysis>
  getMentionGraph(sessionId: string, filter?: TimeFilter): Promise<MentionGraphData>
  getClusterGraph(sessionId: string, filter?: TimeFilter, options?: ClusterGraphOptions): Promise<ClusterGraphData>
  getLaughAnalysis(sessionId: string, filter?: TimeFilter, keywords?: string[]): Promise<LaughAnalysis>
  getRelationshipStats(
    sessionId: string,
    filter?: TimeFilter,
    options?: { perseveranceThreshold?: number }
  ): Promise<RelationshipStats>

  // ==================== SQL Lab ====================

  executeSQL(sessionId: string, sql: string): Promise<SQLResult>
  getSchema(sessionId: string): Promise<TableSchema[]>

  // ==================== 通用 SQL 查询 ====================

  /**
   * 执行只读 SQL 查询并返回原始行。
   *
   * 用途边界：仅用于消息浏览/搜索/分页与 session-index 等通用数据访问；
   * 图表与分析必须走专用的缓存端点（core 计算 → analytics 路由 → 上面的 getXxx 方法），
   * 不要再用本方法在前端拉全量数据后自行计算。
   */
  pluginQuery<T = Record<string, unknown>>(sessionId: string, sql: string, params?: unknown[]): Promise<T[]>
}
