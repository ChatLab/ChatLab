/**
 * FetchDataAdapter — 通过 HTTP 调用 /_web/ 内部 API
 *
 * 用于 CLI Web 场景：前端通过 fetch 访问 chatlab start 后端。
 */

import type { AnalysisSession, MessageType } from '@/types/base'
import type { TimeFilter, ApplyOwnerProfileResult, SetOwnerAndApplyProfileResult } from '@openchatlab/shared-types'
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
  DataAdapter,
  PaginationParams,
  PaginatedResult,
  SQLResult,
  TableSchema,
  MentionGraphData,
  MessageLengthDistribution,
} from './types'
import { get, post, del, patch } from '../utils/http'

function buildFilterParams(filter?: TimeFilter): string {
  if (!filter) return ''
  const params = new URLSearchParams()
  if (filter.startTs) params.set('startTs', String(filter.startTs))
  if (filter.endTs) params.set('endTs', String(filter.endTs))
  if (filter.memberId) params.set('memberId', String(filter.memberId))
  const qs = params.toString()
  return qs ? `?${qs}` : ''
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

  // ==================== 时间范围 ====================

  getAvailableYears(sessionId: string): Promise<number[]> {
    return get(`/sessions/${sessionId}/years`)
  }

  getTimeRange(sessionId: string): Promise<{ start: number; end: number } | null> {
    return get(`/sessions/${sessionId}/time-range`)
  }

  // ==================== 统计分析 ====================

  getMemberActivity(sessionId: string, filter?: TimeFilter): Promise<MemberActivity[]> {
    return get(`/sessions/${sessionId}/stats/member-activity${buildFilterParams(filter)}`)
  }

  getHourlyActivity(sessionId: string, filter?: TimeFilter): Promise<HourlyActivity[]> {
    return get(`/sessions/${sessionId}/stats/hourly${buildFilterParams(filter)}`)
  }

  getDailyActivity(sessionId: string, filter?: TimeFilter): Promise<DailyActivity[]> {
    return get(`/sessions/${sessionId}/stats/daily${buildFilterParams(filter)}`)
  }

  getWeekdayActivity(sessionId: string, filter?: TimeFilter): Promise<WeekdayActivity[]> {
    return get(`/sessions/${sessionId}/stats/weekday${buildFilterParams(filter)}`)
  }

  getMonthlyActivity(sessionId: string, filter?: TimeFilter): Promise<MonthlyActivity[]> {
    return get(`/sessions/${sessionId}/analytics/monthly-activity${buildFilterParams(filter)}`)
  }

  getYearlyActivity(sessionId: string, filter?: TimeFilter): Promise<Array<{ year: number; messageCount: number }>> {
    return get(`/sessions/${sessionId}/analytics/yearly-activity${buildFilterParams(filter)}`)
  }

  getMessageLengthDistribution(sessionId: string, filter?: TimeFilter): Promise<MessageLengthDistribution> {
    return get(`/sessions/${sessionId}/analytics/message-length-distribution${buildFilterParams(filter)}`)
  }

  getMessageTypeDistribution(
    sessionId: string,
    filter?: TimeFilter
  ): Promise<Array<{ type: MessageType; count: number }>> {
    return get(`/sessions/${sessionId}/stats/message-types${buildFilterParams(filter)}`)
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
    return get(`/sessions/${sessionId}/analytics/catchphrase${buildFilterParams(filter)}`)
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
    return get(`/sessions/${sessionId}/analytics/language-preference?${params}`)
  }

  getMentionAnalysis(sessionId: string, filter?: TimeFilter): Promise<MentionAnalysis> {
    return get(`/sessions/${sessionId}/analytics/mention${buildFilterParams(filter)}`)
  }

  getMentionGraph(sessionId: string, filter?: TimeFilter): Promise<MentionGraphData> {
    return get(`/sessions/${sessionId}/analytics/mention-graph${buildFilterParams(filter)}`)
  }

  getClusterGraph(sessionId: string, filter?: TimeFilter, options?: ClusterGraphOptions): Promise<ClusterGraphData> {
    const params = new URLSearchParams()
    if (filter?.startTs) params.set('startTs', String(filter.startTs))
    if (filter?.endTs) params.set('endTs', String(filter.endTs))
    if (filter?.memberId) params.set('memberId', String(filter.memberId))
    if (options?.topEdges) params.set('topEdges', String(options.topEdges))
    const qs = params.toString()
    return get(`/sessions/${sessionId}/analytics/cluster${qs ? `?${qs}` : ''}`)
  }

  getLaughAnalysis(sessionId: string, filter?: TimeFilter, _keywords?: string[]): Promise<LaughAnalysis> {
    return get(`/sessions/${sessionId}/analytics/laugh${buildFilterParams(filter)}`)
  }

  getRelationshipStats(
    sessionId: string,
    filter?: TimeFilter,
    _options?: { perseveranceThreshold?: number }
  ): Promise<RelationshipStats> {
    return get(`/sessions/${sessionId}/analytics/relationship${buildFilterParams(filter)}`)
  }

  // ==================== SQL Lab ====================

  executeSQL(sessionId: string, sql: string): Promise<SQLResult> {
    return post(`/sessions/${sessionId}/sql`, { sql })
  }

  getSchema(sessionId: string): Promise<TableSchema[]> {
    return get(`/sessions/${sessionId}/schema`)
  }

  // ==================== 插件系统 ====================

  pluginQuery<T = Record<string, unknown>>(sessionId: string, sql: string, params?: unknown[]): Promise<T[]> {
    return post<T[]>(`/sessions/${sessionId}/query`, { sql, params: params ?? [] })
  }

  async pluginCompute<T = unknown>(fnString: string, input: unknown): Promise<T> {
    const fn = new Function('return ' + fnString)()
    return Promise.resolve(fn(input))
  }
}
