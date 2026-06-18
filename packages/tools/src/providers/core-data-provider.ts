/**
 * CoreDataProvider
 *
 * ToolDataProvider implementation backed by @openchatlab/core query functions.
 * Used by Server / MCP, accessing SQLite through DatabaseAdapter.
 */

import type { DatabaseAdapter } from '@openchatlab/core'
import {
  searchMessagesByKeywords,
  getRecentMessages as coreGetRecentMessages,
  getMemberActivity,
  getHourlyActivity,
  getWeekdayActivity,
  getDailyActivity,
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
  SearchMessagesResult,
  MemberStatItem,
  SchemaTableInfo,
  TimeFilter,
  ChatOverviewResult,
  MemberInfo,
  NameHistoryItem,
  SegmentMessagesResult,
  ConversationResult,
  SegmentSummaryItem,
  RawMessage,
} from '../types'

export class CoreDataProvider implements ToolDataProvider {
  constructor(private db: DatabaseAdapter) {}

  async searchMessages(
    keywords: string[],
    options?: { timeFilter?: TimeFilter; limit?: number; senderId?: number }
  ): Promise<SearchMessagesResult> {
    const result = searchMessagesByKeywords(this.db, keywords, {
      startTs: options?.timeFilter?.startTs,
      endTs: options?.timeFilter?.endTs,
      senderId: options?.senderId,
      limit: options?.limit ?? 50,
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

  async deepSearchMessages(
    keywords: string[],
    options?: { timeFilter?: TimeFilter; limit?: number; senderId?: number }
  ): Promise<SearchMessagesResult> {
    return this.searchMessages(keywords, options)
  }

  async getSearchMessageContext(
    messageIds: number[],
    contextBefore: number,
    contextAfter: number
  ): Promise<RawMessage[]> {
    return coreGetSearchMessageContext(this.db, messageIds, contextBefore, contextAfter)
  }

  async getRecentMessages(options?: { timeFilter?: TimeFilter; limit?: number }): Promise<SearchMessagesResult> {
    const messages = coreGetRecentMessages(this.db, { limit: options?.limit ?? 50 })
    return {
      messages: messages.map((m) => ({
        id: m.id,
        senderId: m.senderId,
        senderName: m.senderName,
        senderPlatformId: m.senderPlatformId,
        content: m.content,
        timestamp: m.timestamp,
      })),
      total: messages.length,
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

  async getMemberStats(options?: { timeFilter?: TimeFilter; top?: number }): Promise<MemberStatItem[]> {
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

  async getTimeStats(type: 'hourly' | 'weekday' | 'daily', options?: { timeFilter?: TimeFilter }): Promise<unknown[]> {
    const filter = options?.timeFilter
    switch (type) {
      case 'weekday':
        return getWeekdayActivity(this.db, filter)
      case 'daily':
        return getDailyActivity(this.db, filter)
      case 'hourly':
      default:
        return getHourlyActivity(this.db, filter)
    }
  }

  async getSegmentMessages(segmentId: number, limit?: number): Promise<SegmentMessagesResult | null> {
    return coreGetSegmentMessages(this.db, segmentId, limit)
  }

  async getSegmentSummaries(options?: { limit?: number; timeFilter?: TimeFilter }): Promise<SegmentSummaryItem[]> {
    return coreGetSegmentSummaries(this.db, options)
  }

  async getConversationBetween(
    memberId1: number,
    memberId2: number,
    timeFilter?: TimeFilter,
    limit?: number
  ): Promise<ConversationResult> {
    return coreGetConversationBetween(this.db, memberId1, memberId2, timeFilter, limit)
  }

  async executeSql(sql: string): Promise<unknown> {
    return executeReadonlySql(this.db, sql)
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
