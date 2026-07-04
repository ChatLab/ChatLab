/**
 * CoreDataProvider
 *
 * ToolDataProvider implementation backed by @openchatlab/core query functions.
 * Used by Server / MCP, accessing SQLite through DatabaseAdapter.
 */

import type { DatabaseAdapter } from '@openchatlab/core'
import {
  searchMessagesByKeywords,
  queryMessages,
  getMemberActivity,
  getHourlyActivity,
  getWeekdayActivity,
  getDailyActivity,
  getMonthlyActivity,
  executeReadonlySql,
  getDatabaseSchema,
  getMessageContext as coreGetMessageContext,
  getSearchMessageContext as coreGetSearchMessageContext,
  getConversationBetween as coreGetConversationBetween,
  getMemberNameHistory as coreGetMemberNameHistory,
  getMembersWithAliases,
  executeParameterizedSql as coreExecuteParameterizedSql,
  getChatOverview as coreGetChatOverview,
  getSegmentMessages as coreGetSegmentMessages,
  getSegmentSummaries as coreGetSegmentSummaries,
} from '@openchatlab/core'
import type {
  ToolDataProvider,
  SearchMessagesOptions,
  SearchMessagesResult,
  MemberStatItem,
  SchemaTableInfo,
  ToolTimeRange,
  ChatOverviewResult,
  MemberInfo,
  NameHistoryItem,
  SegmentMessagesResult,
  ConversationResult,
  SegmentSummaryItem,
  RawMessage,
} from '../types'

const TOOL_MESSAGE_LIMIT_CAP = 50000

export class CoreDataProvider implements ToolDataProvider {
  constructor(private db: DatabaseAdapter) {}

  async searchMessages(keywords: string[], options?: SearchMessagesOptions): Promise<SearchMessagesResult> {
    const result = searchMessagesByKeywords(this.db, keywords, {
      startTs: options?.timeFilter?.startTs,
      endTs: options?.timeFilter?.endTs,
      senderId: options?.senderId,
      limit: options?.limit ?? 50,
      offset: options?.offset,
      matchMode: options?.matchMode,
      excludeKeywords: options?.excludeKeywords,
      sort: options?.sort,
    })
    return {
      messages: result.messages.map((m) => ({
        id: m.id,
        senderId: m.senderId,
        senderName: m.senderName,
        senderPlatformId: m.senderPlatformId,
        content: m.content,
        timestamp: m.timestamp,
      })),
      total: result.total ?? result.messages.length,
    }
  }

  async deepSearchMessages(keywords: string[], options?: SearchMessagesOptions): Promise<SearchMessagesResult> {
    return this.searchMessages(keywords, options)
  }

  async getSearchMessageContext(
    messageIds: number[],
    contextBefore: number,
    contextAfter: number
  ): Promise<RawMessage[]> {
    return coreGetSearchMessageContext(this.db, messageIds, contextBefore, contextAfter)
  }

  async getRecentMessages(options?: { timeFilter?: ToolTimeRange; limit?: number }): Promise<SearchMessagesResult> {
    const result = queryMessages(this.db, {
      limit: options?.limit ?? 50,
      maxLimit: TOOL_MESSAGE_LIMIT_CAP,
      startTs: options?.timeFilter?.startTs,
      endTs: options?.timeFilter?.endTs,
    })
    return {
      messages: result.messages.map((m) => ({
        id: m.id,
        senderId: m.senderId,
        senderName: m.senderName,
        senderPlatformId: m.senderPlatformId,
        content: m.content,
        timestamp: m.timestamp,
      })),
      total: result.total,
    }
  }

  async getMessageContext(messageIds: number[], contextSize: number): Promise<RawMessage[]> {
    return coreGetMessageContext(this.db, messageIds, contextSize)
  }

  async getChatOverview(topN?: number): Promise<ChatOverviewResult | null> {
    return coreGetChatOverview(this.db, topN)
  }

  async getMembers(): Promise<MemberInfo[]> {
    return getMembersWithAliases(this.db)
  }

  async getMemberStats(options?: { timeFilter?: ToolTimeRange; top?: number }): Promise<MemberStatItem[]> {
    const top = options?.top ?? 20
    const members = getMemberActivity(this.db, options?.timeFilter)
    return members.slice(0, top).map((m) => ({
      name: m.name,
      messageCount: m.messageCount,
      percentage: m.percentage,
    }))
  }

  async getMemberNameHistory(memberId: number): Promise<NameHistoryItem[]> {
    return coreGetMemberNameHistory(this.db, memberId)
  }

  async getTimeStats(
    type: 'hourly' | 'weekday' | 'daily' | 'monthly',
    options?: { timeFilter?: ToolTimeRange }
  ): Promise<unknown[]> {
    const filter = options?.timeFilter
    switch (type) {
      case 'weekday':
        return getWeekdayActivity(this.db, filter)
      case 'daily':
        return getDailyActivity(this.db, filter)
      case 'monthly':
        return getMonthlyActivity(this.db, filter)
      case 'hourly':
      default:
        return getHourlyActivity(this.db, filter)
    }
  }

  async getSegmentMessages(segmentId: number, limit?: number): Promise<SegmentMessagesResult | null> {
    return coreGetSegmentMessages(this.db, segmentId, limit)
  }

  async getSegmentSummaries(options?: { limit?: number; timeFilter?: ToolTimeRange }): Promise<SegmentSummaryItem[]> {
    return coreGetSegmentSummaries(this.db, options)
  }

  async getConversationBetween(
    memberId1: number,
    memberId2: number,
    timeFilter?: ToolTimeRange,
    limit?: number
  ): Promise<ConversationResult> {
    return coreGetConversationBetween(this.db, memberId1, memberId2, timeFilter, limit)
  }

  async executeSql(sql: string, options?: { maxRows?: number }): Promise<unknown> {
    return executeReadonlySql(this.db, sql, options?.maxRows)
  }

  async executeParameterizedSql<T = Record<string, unknown>>(
    query: string,
    params: Record<string, unknown>
  ): Promise<T[]> {
    return coreExecuteParameterizedSql<T>(this.db, query, params)
  }

  async getSchema(): Promise<SchemaTableInfo[]> {
    return getDatabaseSchema(this.db)
  }
}
