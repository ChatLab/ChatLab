/**
 * FetchDataAdapter — 通过 HTTP 调用 /_web/ 内部 API
 *
 * 用于 CLI Web 场景：前端通过 fetch 访问 chatlab start 后端。
 */

import type { AnalysisSession, MessageType } from '@/types/base'
import type {
  TimeFilter,
  ApplyOwnerProfileResult,
  SetOwnerAndApplyProfileResult,
  ContactsResponse,
  ContactDetailResponse,
  PeopleRelationshipsGraphResponse,
  PeopleRelationshipsNeighborhoodResponse,
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
import type {
  DataAdapter,
  ContactsFetchOptions,
  ContactsRecomputeOptions,
  PeopleRelationshipsFetchOptions,
  PeopleRelationshipsRecomputeOptions,
  AnnualSummaryFetchOptions,
  PaginationParams,
  PaginatedResult,
  SQLResult,
  TableSchema,
  MentionGraphData,
  MessageLengthDistribution,
} from './types'
import { get, post, del, put, patch, analyticsGet } from '../utils/http'

function buildFilterParams(filter?: TimeFilter): string {
  if (!filter) return ''
  const params = new URLSearchParams()
  if (filter.startTs) params.set('startTs', String(filter.startTs))
  if (filter.endTs) params.set('endTs', String(filter.endTs))
  if (filter.memberId) params.set('memberId', String(filter.memberId))
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

function buildAnnualSummaryParams(options?: AnnualSummaryFetchOptions): string {
  const params = new URLSearchParams()
  if (options?.mode) params.set('mode', options.mode)
  if (options?.year) params.set('year', String(options.year))
  if (options?.days) params.set('days', String(options.days))
  if (options?.acceptStale) params.set('acceptStale', '1')
  const query = params.toString()
  return query ? `?${query}` : ''
}

export class FetchDataAdapter implements DataAdapter {
  // ==================== 会话管理 ====================

  getSessions(): Promise<AnalysisSession[]> {
    return get('/sessions')
  }

  getSession(sessionId: string): Promise<AnalysisSession | null> {
    return get(`/sessions/${sessionId}`)
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const result = await del<{ success: boolean }>(`/sessions/${sessionId}`)
    return result.success
  }

  async renameSession(sessionId: string, newName: string): Promise<boolean> {
    const result = await patch<{ success: boolean }>(`/sessions/${sessionId}/name`, {
      name: newName,
    })
    return result.success
  }

  async updateSessionOwnerId(sessionId: string, ownerId: string | null): Promise<boolean> {
    const result = await patch<{ success: boolean }>(`/sessions/${sessionId}/owner`, {
      ownerId,
    })
    return result.success
  }

  tryApplyOwnerProfile(sessionId: string): Promise<ApplyOwnerProfileResult> {
    return post(`/sessions/${sessionId}/owner/apply-profile`, {})
  }

  setOwnerAndApplyProfile(sessionId: string, ownerPlatformId: string): Promise<SetOwnerAndApplyProfileResult> {
    return post(`/sessions/${sessionId}/owner/select`, { ownerPlatformId })
  }

  async dismissOwnerPrompt(sessionId: string): Promise<boolean> {
    const result = await post<{ success: boolean }>(`/sessions/${sessionId}/owner/dismiss-prompt`, {})
    return result.success
  }

  // ==================== 联系人 ====================

  getContacts(options?: ContactsFetchOptions): Promise<ContactsResponse> {
    const params = new URLSearchParams()
    if (options?.acceptStale) params.set('acceptStale', '1')
    if (options?.timeRangePreset) params.set('timeRange', options.timeRangePreset)
    if (options?.pool) params.set('pool', options.pool)
    if (options?.page) params.set('page', String(options.page))
    if (options?.pageSize) params.set('pageSize', String(options.pageSize))
    if (options?.query) params.set('q', options.query)
    const qs = params.toString()
    return get(`/contacts${qs ? `?${qs}` : ''}`)
  }

  getContactDetail(key: string, options?: ContactsFetchOptions): Promise<ContactDetailResponse> {
    const params = new URLSearchParams()
    if (options?.acceptStale) params.set('acceptStale', '1')
    if (options?.timeRangePreset) params.set('timeRange', options.timeRangePreset)
    const qs = params.toString()
    return get(`/contacts/${encodeURIComponent(key)}/detail${qs ? `?${qs}` : ''}`)
  }

  recomputeContacts(options?: ContactsRecomputeOptions): Promise<ContactsResponse> {
    const params = new URLSearchParams()
    if (options?.timeRangePreset) params.set('timeRange', options.timeRangePreset)
    if (options?.pool) params.set('pool', options.pool)
    if (options?.page) params.set('page', String(options.page))
    if (options?.pageSize) params.set('pageSize', String(options.pageSize))
    if (options?.query) params.set('q', options.query)
    const qs = params.toString()
    return post(`/contacts/recompute${qs ? `?${qs}` : ''}`, {})
  }

  async markContactAsFriend(key: string, options?: ContactsFetchOptions): Promise<boolean> {
    const params = new URLSearchParams()
    if (options?.timeRangePreset) params.set('timeRange', options.timeRangePreset)
    const qs = params.toString()
    const result = await put<{ success: boolean }>(
      `/contacts/${encodeURIComponent(key)}/mark-friend${qs ? `?${qs}` : ''}`
    )
    return result.success
  }

  async unmarkContactAsFriend(key: string, options?: ContactsFetchOptions): Promise<boolean> {
    const params = new URLSearchParams()
    if (options?.timeRangePreset) params.set('timeRange', options.timeRangePreset)
    const qs = params.toString()
    const result = await del<{ success: boolean }>(
      `/contacts/${encodeURIComponent(key)}/mark-friend${qs ? `?${qs}` : ''}`
    )
    return result.success
  }

  // ==================== 关系图谱 ====================

  getPeopleRelationships(options?: PeopleRelationshipsFetchOptions): Promise<PeopleRelationshipsGraphResponse> {
    const params = new URLSearchParams()
    if (options?.acceptStale) params.set('acceptStale', '1')
    if (options?.timeRangePreset) params.set('timeRange', options.timeRangePreset)
    if (options?.graphScope) params.set('scope', options.graphScope)
    if (options?.query) params.set('q', options.query)
    const qs = params.toString()
    return get(`/people/relationships${qs ? `?${qs}` : ''}`)
  }

  recomputePeopleRelationships(
    options?: PeopleRelationshipsRecomputeOptions
  ): Promise<PeopleRelationshipsGraphResponse> {
    const params = new URLSearchParams()
    if (options?.timeRangePreset) params.set('timeRange', options.timeRangePreset)
    if (options?.graphScope) params.set('scope', options.graphScope)
    if (options?.query) params.set('q', options.query)
    const qs = params.toString()
    return post(`/people/relationships/recompute${qs ? `?${qs}` : ''}`, {})
  }

  getPeopleRelationshipNeighborhood(
    key: string,
    options?: PeopleRelationshipsFetchOptions
  ): Promise<PeopleRelationshipsNeighborhoodResponse> {
    const params = new URLSearchParams()
    if (options?.acceptStale) params.set('acceptStale', '1')
    if (options?.timeRangePreset) params.set('timeRange', options.timeRangePreset)
    const qs = params.toString()
    return get(`/people/relationships/${encodeURIComponent(key)}/neighborhood${qs ? `?${qs}` : ''}`)
  }

  // ==================== 全局洞察 ====================

  getAnnualSummary(options?: AnnualSummaryFetchOptions): Promise<AnnualSummaryResponse> {
    return get(`/global-insight/annual-summary${buildAnnualSummaryParams(options)}`)
  }

  recomputeAnnualSummary(options?: AnnualSummaryFetchOptions): Promise<AnnualSummaryResponse> {
    return post(`/global-insight/annual-summary/recompute${buildAnnualSummaryParams(options)}`, {})
  }

  // ==================== 时间范围 ====================

  getAvailableYears(sessionId: string): Promise<number[]> {
    return get(`/sessions/${sessionId}/years`)
  }

  getTimeRange(sessionId: string): Promise<{ start: number; end: number } | null> {
    return get(`/sessions/${sessionId}/time-range`)
  }

  // ==================== 统计分析 ====================

  getMemberActivity(sessionId: string, filter?: TimeFilter): Promise<MemberActivity[]> {
    return analyticsGet(`/sessions/${sessionId}/stats/member-activity${buildFilterParams(filter)}`)
  }

  getHourlyActivity(sessionId: string, filter?: TimeFilter): Promise<HourlyActivity[]> {
    return analyticsGet(`/sessions/${sessionId}/stats/hourly${buildFilterParams(filter)}`)
  }

  getDailyActivity(sessionId: string, filter?: TimeFilter): Promise<DailyActivity[]> {
    return analyticsGet(`/sessions/${sessionId}/stats/daily${buildFilterParams(filter)}`)
  }

  getWeekdayActivity(sessionId: string, filter?: TimeFilter): Promise<WeekdayActivity[]> {
    return analyticsGet(`/sessions/${sessionId}/stats/weekday${buildFilterParams(filter)}`)
  }

  getMonthlyActivity(sessionId: string, filter?: TimeFilter): Promise<MonthlyActivity[]> {
    return analyticsGet(`/sessions/${sessionId}/analytics/monthly-activity${buildFilterParams(filter)}`)
  }

  getYearlyActivity(sessionId: string, filter?: TimeFilter): Promise<Array<{ year: number; messageCount: number }>> {
    return analyticsGet(`/sessions/${sessionId}/analytics/yearly-activity${buildFilterParams(filter)}`)
  }

  getMessageLengthDistribution(sessionId: string, filter?: TimeFilter): Promise<MessageLengthDistribution> {
    return analyticsGet(`/sessions/${sessionId}/analytics/message-length-distribution${buildFilterParams(filter)}`)
  }

  getMessageTypeDistribution(
    sessionId: string,
    filter?: TimeFilter
  ): Promise<Array<{ type: MessageType; count: number }>> {
    return analyticsGet(`/sessions/${sessionId}/stats/message-types${buildFilterParams(filter)}`)
  }

  getTextStats(sessionId: string, filter?: TimeFilter): Promise<TextStats> {
    return analyticsGet(`/sessions/${sessionId}/analytics/text-stats${buildFilterParams(filter)}`)
  }

  getLongMessageCount(sessionId: string, filter?: TimeFilter, minLength?: number): Promise<number> {
    const params = new URLSearchParams()
    if (filter?.startTs) params.set('startTs', String(filter.startTs))
    if (filter?.endTs) params.set('endTs', String(filter.endTs))
    if (filter?.memberId) params.set('memberId', String(filter.memberId))
    if (minLength != null) params.set('minLength', String(minLength))
    const qs = params.toString()
    return analyticsGet(`/sessions/${sessionId}/analytics/long-message-count${qs ? `?${qs}` : ''}`)
  }

  getMemberMonthlyTrend(sessionId: string, filter?: TimeFilter): Promise<MemberMonthlyTrend[]> {
    return analyticsGet(`/sessions/${sessionId}/analytics/member-monthly-trend${buildFilterParams(filter)}`)
  }

  getTextLengthPercentiles(sessionId: string, filter?: TimeFilter): Promise<TextLengthPercentiles> {
    return analyticsGet(`/sessions/${sessionId}/analytics/text-length-percentiles${buildFilterParams(filter)}`)
  }

  getDragonKingAnalysis(sessionId: string, filter?: TimeFilter): Promise<DragonKingAnalysis> {
    return analyticsGet(`/sessions/${sessionId}/analytics/dragon-king${buildFilterParams(filter)}`)
  }

  getDivingAnalysis(sessionId: string, filter?: TimeFilter): Promise<DivingAnalysis> {
    return analyticsGet(`/sessions/${sessionId}/analytics/diving${buildFilterParams(filter)}`)
  }

  getCheckInAnalysis(sessionId: string, filter?: TimeFilter): Promise<CheckInAnalysis> {
    return analyticsGet(`/sessions/${sessionId}/analytics/check-in${buildFilterParams(filter)}`)
  }

  getMemeBattleAnalysis(sessionId: string, filter?: TimeFilter): Promise<MemeBattleAnalysis> {
    return analyticsGet(`/sessions/${sessionId}/analytics/meme-battle${buildFilterParams(filter)}`)
  }

  getNightOwlAnalysis(sessionId: string, filter?: TimeFilter): Promise<NightOwlAnalysis> {
    return analyticsGet(`/sessions/${sessionId}/analytics/night-owl${buildFilterParams(filter)}`)
  }

  getRepeatAnalysis(sessionId: string, filter?: TimeFilter): Promise<RepeatAnalysis> {
    return analyticsGet(`/sessions/${sessionId}/analytics/repeat${buildFilterParams(filter)}`)
  }

  // ==================== 成员管理 ====================

  getMembers(sessionId: string): Promise<MemberWithStats[]> {
    return get(`/sessions/${sessionId}/members`)
  }

  getMembersPaginated(sessionId: string, params: PaginationParams): Promise<PaginatedResult<MemberWithStats>> {
    const qs = new URLSearchParams({
      page: String(params.page),
      pageSize: String(params.pageSize),
    })
    if (params.search) qs.set('search', params.search)
    if (params.sortOrder) qs.set('sortOrder', params.sortOrder)
    return get(`/sessions/${sessionId}/members/paginated?${qs}`)
  }

  getMemberNameHistory(sessionId: string, memberId: number): Promise<MemberNameHistory[]> {
    return get(`/sessions/${sessionId}/members/${memberId}/history`)
  }

  async updateMemberAliases(sessionId: string, memberId: number, aliases: string[]): Promise<boolean> {
    const result = await patch<{ success: boolean }>(`/sessions/${sessionId}/members/${memberId}/aliases`, {
      aliases,
    })
    return result.success
  }

  async mergeMembers(sessionId: string, memberId1: number, memberId2: number): Promise<boolean> {
    const result = await post<{ success: boolean }>(`/sessions/${sessionId}/members/merge`, {
      memberId1,
      memberId2,
    })
    return result.success
  }

  async deleteMember(sessionId: string, memberId: number): Promise<boolean> {
    const result = await del<{ success: boolean }>(`/sessions/${sessionId}/members/${memberId}`)
    return result.success
  }

  // ==================== 社交分析 ====================

  getCatchphraseAnalysis(sessionId: string, filter?: TimeFilter): Promise<CatchphraseAnalysis> {
    return analyticsGet(`/sessions/${sessionId}/analytics/catchphrase${buildFilterParams(filter)}`)
  }

  getLanguagePreferenceAnalysis(
    sessionId: string,
    locale: string,
    filter?: TimeFilter,
    _dictType?: string
  ): Promise<LanguagePreferenceResult> {
    const params = new URLSearchParams()
    params.set('locale', locale)
    if (filter?.startTs) params.set('startTs', String(filter.startTs))
    if (filter?.endTs) params.set('endTs', String(filter.endTs))
    if (filter?.memberId) params.set('memberId', String(filter.memberId))
    return analyticsGet(`/sessions/${sessionId}/analytics/language-preference?${params}`)
  }

  getMentionAnalysis(sessionId: string, filter?: TimeFilter): Promise<MentionAnalysis> {
    return analyticsGet(`/sessions/${sessionId}/analytics/mention${buildFilterParams(filter)}`)
  }

  getMentionGraph(sessionId: string, filter?: TimeFilter): Promise<MentionGraphData> {
    return analyticsGet(`/sessions/${sessionId}/analytics/mention-graph${buildFilterParams(filter)}`)
  }

  getClusterGraph(sessionId: string, filter?: TimeFilter, options?: ClusterGraphOptions): Promise<ClusterGraphData> {
    const params = new URLSearchParams()
    if (filter?.startTs) params.set('startTs', String(filter.startTs))
    if (filter?.endTs) params.set('endTs', String(filter.endTs))
    if (filter?.memberId) params.set('memberId', String(filter.memberId))
    if (options?.topEdges) params.set('topEdges', String(options.topEdges))
    if (options?.lookAhead) params.set('lookAhead', String(options.lookAhead))
    if (options?.decaySeconds) params.set('decaySeconds', String(options.decaySeconds))
    const qs = params.toString()
    return analyticsGet(`/sessions/${sessionId}/analytics/cluster${qs ? `?${qs}` : ''}`)
  }

  getLaughAnalysis(sessionId: string, filter?: TimeFilter, _keywords?: string[]): Promise<LaughAnalysis> {
    return analyticsGet(`/sessions/${sessionId}/analytics/laugh${buildFilterParams(filter)}`)
  }

  getRelationshipStats(
    sessionId: string,
    filter?: TimeFilter,
    _options?: { perseveranceThreshold?: number }
  ): Promise<RelationshipStats> {
    return analyticsGet(`/sessions/${sessionId}/analytics/relationship${buildFilterParams(filter)}`)
  }

  // ==================== SQL Lab ====================

  executeSQL(sessionId: string, sql: string): Promise<SQLResult> {
    return post(`/sessions/${sessionId}/sql`, { sql })
  }

  getSchema(sessionId: string): Promise<TableSchema[]> {
    return get(`/sessions/${sessionId}/schema`)
  }

  // ==================== 通用 SQL 查询 ====================

  pluginQuery<T = Record<string, unknown>>(sessionId: string, sql: string, params?: unknown[]): Promise<T[]> {
    return post<T[]>(`/sessions/${sessionId}/query`, { sql, params: params ?? [] })
  }
}
