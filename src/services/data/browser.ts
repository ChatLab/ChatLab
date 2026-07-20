import {
  sessionDatabaseFilename,
  type BrowserSessionCatalogItem,
  type WebRuntimeTaskPayload,
  type WebRuntimeTaskResult,
  type WebRuntimeTaskType,
} from '@openchatlab/web-runtime'
import type { AnalysisSession, MessageType } from '@/types/base'
import type {
  ClusterGraphData,
  ClusterGraphOptions,
  DailyActivity,
  HourlyActivity,
  MemberActivity,
  MemberWithStats,
  MentionAnalysis,
  MonthlyActivity,
  RelationshipStats,
  WeekdayActivity,
} from '@/types/analysis'
import type { LanguagePreferenceResult } from '@/types/quotes/languagePreference'
import type { MemberMonthlyTrend, WordFrequencyParams, WordFrequencyResult } from '@openchatlab/core'
import type { TimeFilter } from '@openchatlab/shared-types'
import type { BrowserRuntimeRpcPort } from '../browser-runtime/types'
import { withAnalyticsRequestEpoch } from '../utils/http'
import type { DataAdapter } from './types'

type BrowserSessionDataAdapter = Pick<
  DataAdapter,
  | 'getSessions'
  | 'getSession'
  | 'deleteSession'
  | 'renameSession'
  | 'getHourlyActivity'
  | 'getDailyActivity'
  | 'getWeekdayActivity'
  | 'getTimeRange'
  | 'getAvailableYears'
  | 'getMemberActivity'
  | 'getMessageTypeDistribution'
  | 'getMessageLengthDistribution'
  | 'getTextStats'
  | 'getLongMessageCount'
  | 'getTextLengthPercentiles'
  | 'getMonthlyActivity'
  | 'getYearlyActivity'
  | 'getMemberMonthlyTrend'
  | 'getMembers'
  | 'getMentionAnalysis'
  | 'getMentionGraph'
  | 'getClusterGraph'
  | 'getRelationshipStats'
  | 'getLanguagePreferenceAnalysis'
  | 'getWordFrequency'
>

export class BrowserDataAdapter implements BrowserSessionDataAdapter {
  constructor(private readonly rpc: BrowserRuntimeRpcPort) {}

  private requestAnalysis<T extends WebRuntimeTaskType>(
    type: T,
    payload: WebRuntimeTaskPayload<T>
  ): Promise<WebRuntimeTaskResult<T>> {
    return withAnalyticsRequestEpoch((signal) => this.rpc.request(type, payload, { signal }))
  }

  async getSessions(): Promise<AnalysisSession[]> {
    return (await this.rpc.request('session.list', undefined)).map(mapSession)
  }

  async getSession(sessionId: string): Promise<AnalysisSession | null> {
    const session = await this.rpc.request('session.get', { sessionId })
    return session ? mapSession(session) : null
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    return (await this.rpc.request('session.delete', { sessionId })).deleted
  }

  async renameSession(sessionId: string, newName: string): Promise<boolean> {
    return (await this.rpc.request('session.rename', { sessionId, name: newName })).renamed
  }

  getHourlyActivity(sessionId: string, filter?: TimeFilter): Promise<HourlyActivity[]> {
    return this.requestAnalysis('analysis.hourly', { sessionId, filter })
  }

  getDailyActivity(sessionId: string, filter?: TimeFilter): Promise<DailyActivity[]> {
    return this.requestAnalysis('analysis.daily', { sessionId, filter })
  }

  getWeekdayActivity(sessionId: string, filter?: TimeFilter): Promise<WeekdayActivity[]> {
    return this.requestAnalysis('analysis.weekday', { sessionId, filter })
  }

  getTimeRange(sessionId: string): Promise<{ start: number; end: number } | null> {
    return this.rpc.request('analysis.timeRange', { sessionId })
  }

  getAvailableYears(sessionId: string): Promise<number[]> {
    return this.rpc.request('analysis.availableYears', { sessionId })
  }

  getMemberActivity(sessionId: string, filter?: TimeFilter): Promise<MemberActivity[]> {
    return this.requestAnalysis('analysis.members', { sessionId, filter })
  }

  async getMessageTypeDistribution(
    sessionId: string,
    filter?: TimeFilter
  ): Promise<Array<{ type: MessageType; count: number }>> {
    return (await this.requestAnalysis('analysis.messageTypes', { sessionId, filter })).map((item) => ({
      type: item.type as MessageType,
      count: item.count,
    }))
  }

  getMessageLengthDistribution(sessionId: string, filter?: TimeFilter) {
    return this.requestAnalysis('analysis.messageLengths', { sessionId, filter })
  }

  getTextStats(sessionId: string, filter?: TimeFilter) {
    return this.requestAnalysis('analysis.textStats', { sessionId, filter })
  }

  getLongMessageCount(sessionId: string, filter?: TimeFilter, minLength?: number) {
    return this.requestAnalysis('analysis.longMessages', { sessionId, filter, minLength })
  }

  getTextLengthPercentiles(sessionId: string, filter?: TimeFilter) {
    return this.requestAnalysis('analysis.textPercentiles', { sessionId, filter })
  }

  getMonthlyActivity(sessionId: string, filter?: TimeFilter): Promise<MonthlyActivity[]> {
    return this.requestAnalysis('analysis.monthly', { sessionId, filter })
  }

  getYearlyActivity(sessionId: string, filter?: TimeFilter): Promise<Array<{ year: number; messageCount: number }>> {
    return this.requestAnalysis('analysis.yearly', { sessionId, filter })
  }

  getMemberMonthlyTrend(sessionId: string, filter?: TimeFilter): Promise<MemberMonthlyTrend[]> {
    return this.requestAnalysis('analysis.memberMonthlyTrend', { sessionId, filter })
  }

  getMembers(sessionId: string): Promise<MemberWithStats[]> {
    return this.rpc.request('analysis.memberList', { sessionId })
  }

  getMentionAnalysis(sessionId: string, filter?: TimeFilter): Promise<MentionAnalysis> {
    return this.requestAnalysis('analysis.mentions', { sessionId, filter })
  }

  getMentionGraph(sessionId: string, filter?: TimeFilter) {
    return this.requestAnalysis('analysis.mentionGraph', { sessionId, filter })
  }

  getClusterGraph(sessionId: string, filter?: TimeFilter, options?: ClusterGraphOptions): Promise<ClusterGraphData> {
    return this.requestAnalysis('analysis.clusterGraph', { sessionId, filter, options })
  }

  getRelationshipStats(
    sessionId: string,
    filter?: TimeFilter,
    options?: { perseveranceThreshold?: number }
  ): Promise<RelationshipStats> {
    return this.requestAnalysis('analysis.relationship', { sessionId, filter, options })
  }

  async getLanguagePreferenceAnalysis(
    sessionId: string,
    locale: string,
    filter?: TimeFilter
  ): Promise<LanguagePreferenceResult> {
    return (await this.requestAnalysis('analysis.languagePreference', {
      sessionId,
      locale,
      filter,
    })) as LanguagePreferenceResult
  }

  getWordFrequency(sessionId: string, params: Omit<WordFrequencyParams, 'sessionId'>): Promise<WordFrequencyResult> {
    return this.requestAnalysis('analysis.wordFrequency', { sessionId, params })
  }
}

export function createBrowserDataAdapter(rpc: BrowserRuntimeRpcPort): DataAdapter {
  const adapter = new BrowserDataAdapter(rpc)
  return new Proxy(adapter, {
    get(target, property) {
      if (property in target) {
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      }
      if (typeof property === 'string') {
        return () => Promise.reject(new Error(`${property} is not available in Web WASM`))
      }
      return undefined
    },
  }) as unknown as DataAdapter
}

function mapSession(item: BrowserSessionCatalogItem): AnalysisSession {
  return {
    id: item.id,
    name: item.name,
    platform: item.platform as AnalysisSession['platform'],
    type: item.type as AnalysisSession['type'],
    importedAt: item.importedAt,
    messageCount: item.messageCount,
    memberCount: item.memberCount,
    dbPath: sessionDatabaseFilename(item.id),
    groupId: item.groupId,
    groupAvatar: item.groupAvatar,
    ownerId: item.ownerId,
    ownerName: null,
    ownerStatus: item.ownerId ? 'unresolved' : 'missing',
    memberAvatar: null,
    lastMessageTs: item.lastMessageTs,
    summaryCount: 0,
    aiConversationCount: 0,
  }
}
