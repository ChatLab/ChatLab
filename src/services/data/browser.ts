import { sessionDatabaseFilename, type BrowserSessionCatalogItem } from '@openchatlab/web-runtime'
import type { AnalysisSession, MessageType } from '@/types/base'
import type { DailyActivity, HourlyActivity, MemberActivity, WeekdayActivity } from '@/types/analysis'
import type { TimeFilter } from '@openchatlab/shared-types'
import type { BrowserRuntimeRpcPort } from '../browser-runtime/types'
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
>

export class BrowserDataAdapter implements BrowserSessionDataAdapter {
  constructor(private readonly rpc: BrowserRuntimeRpcPort) {}

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
    return this.rpc.request('analysis.hourly', { sessionId, filter })
  }

  getDailyActivity(sessionId: string, filter?: TimeFilter): Promise<DailyActivity[]> {
    return this.rpc.request('analysis.daily', { sessionId, filter })
  }

  getWeekdayActivity(sessionId: string, filter?: TimeFilter): Promise<WeekdayActivity[]> {
    return this.rpc.request('analysis.weekday', { sessionId, filter })
  }

  getTimeRange(sessionId: string): Promise<{ start: number; end: number } | null> {
    return this.rpc.request('analysis.timeRange', { sessionId })
  }

  getAvailableYears(sessionId: string): Promise<number[]> {
    return this.rpc.request('analysis.availableYears', { sessionId })
  }

  getMemberActivity(sessionId: string, filter?: TimeFilter): Promise<MemberActivity[]> {
    return this.rpc.request('analysis.members', { sessionId, filter })
  }

  async getMessageTypeDistribution(
    sessionId: string,
    filter?: TimeFilter
  ): Promise<Array<{ type: MessageType; count: number }>> {
    return (await this.rpc.request('analysis.messageTypes', { sessionId, filter })).map((item) => ({
      type: item.type as MessageType,
      count: item.count,
    }))
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
