/**
 * WorkerDataProvider
 *
 * 基于 workerManager 的 ToolDataProvider 实现。
 * 通过 Worker IPC 异步访问 SQLite，供 Electron Agent 使用。
 */

import * as workerManager from '../../worker/workerManager'
import type {
  ToolDataProvider,
  SearchMessagesResult,
  MemberStatItem,
  SchemaTableInfo,
  TimeFilter,
  ChatOverviewResult,
  MemberInfo,
  NameHistoryItem,
  SegmentSearchResult,
  SegmentMessagesResult,
  ConversationResult,
  SegmentSummaryItem,
  RawMessage,
} from '@openchatlab/tools'

function mapSearchMessages(messages: workerManager.SearchMessageResult[]): RawMessage[] {
  return messages.map((m) => ({
    id: m.id,
    senderName: m.senderName,
    senderPlatformId: m.senderPlatformId,
    content: m.content,
    timestamp: m.timestamp,
  }))
}

export class WorkerDataProvider implements ToolDataProvider {
  constructor(private sessionId: string) {}

  async searchMessages(
    keywords: string[],
    options?: { timeFilter?: TimeFilter; limit?: number; senderId?: number }
  ): Promise<SearchMessagesResult> {
    const result = await workerManager.searchMessages(
      this.sessionId,
      keywords,
      options?.timeFilter,
      options?.limit ?? 50,
      0,
      options?.senderId
    )
    return { messages: mapSearchMessages(result.messages), total: result.total }
  }

  async deepSearchMessages(
    keywords: string[],
    options?: { timeFilter?: TimeFilter; limit?: number; senderId?: number }
  ): Promise<SearchMessagesResult> {
    const result = await workerManager.deepSearchMessages(
      this.sessionId,
      keywords,
      options?.timeFilter,
      options?.limit ?? 50,
      0,
      options?.senderId
    )
    return { messages: mapSearchMessages(result.messages), total: result.total }
  }

  async getSearchMessageContext(
    messageIds: number[],
    contextBefore: number,
    contextAfter: number
  ): Promise<RawMessage[]> {
    const messages = await workerManager.getSearchMessageContext(
      this.sessionId,
      messageIds,
      contextBefore,
      contextAfter
    )
    return mapSearchMessages(messages)
  }

  async getRecentMessages(options?: { timeFilter?: TimeFilter; limit?: number }): Promise<SearchMessagesResult> {
    const result = await workerManager.getRecentMessages(this.sessionId, options?.timeFilter, options?.limit ?? 50)
    return { messages: mapSearchMessages(result.messages), total: result.total }
  }

  async getMessageContext(messageIds: number[], contextSize: number): Promise<RawMessage[]> {
    const messages = await workerManager.getMessageContext(this.sessionId, messageIds, contextSize)
    return mapSearchMessages(messages)
  }

  async getChatOverview(topN?: number): Promise<ChatOverviewResult | null> {
    return workerManager.getChatOverview(this.sessionId, topN)
  }

  async getMembers(): Promise<MemberInfo[]> {
    const members = await workerManager.getMembers(this.sessionId)
    return members.map((m) => ({
      id: m.id,
      platformId: m.platformId,
      accountName: m.accountName,
      groupNickname: m.groupNickname,
      aliases: m.aliases,
      messageCount: m.messageCount,
    }))
  }

  async getMemberStats(options?: { timeFilter?: TimeFilter; top?: number }): Promise<MemberStatItem[]> {
    const top = options?.top ?? 20
    const members = await workerManager.getMemberActivity(this.sessionId, options?.timeFilter)
    return members.slice(0, top).map((m: any) => ({
      name: m.name,
      messageCount: m.messageCount,
      percentage: m.percentage,
    }))
  }

  async getMemberNameHistory(memberId: number): Promise<NameHistoryItem[]> {
    return workerManager.getMemberNameHistory(this.sessionId, memberId)
  }

  async getTimeStats(type: 'hourly' | 'weekday' | 'daily', options?: { timeFilter?: TimeFilter }): Promise<unknown[]> {
    const filter = options?.timeFilter
    switch (type) {
      case 'weekday':
        return workerManager.getWeekdayActivity(this.sessionId, filter)
      case 'daily':
        return workerManager.getDailyActivity(this.sessionId, filter)
      case 'hourly':
      default:
        return workerManager.getHourlyActivity(this.sessionId, filter)
    }
  }

  async searchSegments(
    keywords?: string[],
    timeFilter?: TimeFilter,
    limit?: number,
    previewCount?: number
  ): Promise<SegmentSearchResult[]> {
    return workerManager.searchSegments(this.sessionId, keywords, timeFilter, limit, previewCount)
  }

  async getSegmentMessages(segmentId: number, limit?: number): Promise<SegmentMessagesResult | null> {
    return workerManager.getSegmentMessages(this.sessionId, segmentId, limit)
  }

  async getSegmentSummaries(options?: { limit?: number; timeFilter?: TimeFilter }): Promise<SegmentSummaryItem[]> {
    return workerManager.getSegmentSummaries(this.sessionId, {
      limit: options?.limit,
      timeFilter: options?.timeFilter,
    })
  }

  async getConversationBetween(
    memberId1: number,
    memberId2: number,
    timeFilter?: TimeFilter,
    limit?: number
  ): Promise<ConversationResult> {
    const result = await workerManager.getConversationBetween(this.sessionId, memberId1, memberId2, timeFilter, limit)
    return {
      messages: mapSearchMessages(result.messages),
      total: result.total,
      member1Name: result.member1Name,
      member2Name: result.member2Name,
    }
  }

  async executeSql(sql: string): Promise<unknown> {
    return workerManager.executeRawSQL(this.sessionId, sql)
  }

  async executeParameterizedSql<T = Record<string, unknown>>(
    query: string,
    params: Record<string, unknown>
  ): Promise<T[]> {
    return workerManager.pluginQuery<T>(this.sessionId, query, params)
  }

  async getSchema(): Promise<SchemaTableInfo[]> {
    const tables = await workerManager.getSchema(this.sessionId)
    return tables.map((t) => ({
      name: t.name,
      sql: t.columns.map((c) => `${c.name} ${c.type}${c.pk ? ' PK' : ''}${c.notnull ? ' NOT NULL' : ''}`).join(', '),
    }))
  }
}
