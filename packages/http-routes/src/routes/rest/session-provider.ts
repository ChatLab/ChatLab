/** Data access contract for the public REST session routes. */
import {
  executeReadonlySql,
  getLastPlatformMessageId,
  getMemberActivity,
  getMembersWithAliases,
  getMessageTypeStats,
  getSessionInfo,
  getSessionMeta,
  getSessionOverview,
  queryMessages,
} from '@openchatlab/core'
import type { DatabaseManager } from '@openchatlab/node-runtime'

type Awaitable<T> = T | Promise<T>

export interface RestSessionSummary {
  id: string
  name: string
  platform: string
  type: string
  groupId?: string
  messageCount: number
  memberCount: number
  firstTimestamp: number | null
  lastTimestamp: number | null
  importedAt?: number
}

export interface RestSessionDetail extends RestSessionSummary {
  lastPlatformMessageId: string | null
  importedAt: number
}

export interface RestMessageQuery {
  keyword?: string
  startTime?: number
  endTime?: number
  senderId?: number
  limit: number
  offset: number
}

export interface RestMessagePage {
  messages: unknown[]
  total: number
  totalPages?: number
}

export interface RestSessionOverview {
  messageCount: number
  memberCount: number
  timeRange: { start: number; end: number }
  messageTypeDistribution: Record<string, number>
  topMembers: Array<{
    platformId: string
    name: string
    messageCount: number
    percentage: number
  }>
}

export interface RestSessionMember {
  id: number
  platformId: string
  name: string
  messageCount: number
  accountName?: string | null
  groupNickname?: string | null
  aliases?: string[]
  avatar?: string | null
  lastMessageTs?: number | null
}

export type RestSessionMemberInput = Omit<RestSessionMember, 'name'> & { name?: string | null }

export function normalizeRestSessionMember(member: RestSessionMemberInput): RestSessionMember {
  return {
    ...member,
    name: member.name || member.groupNickname || member.accountName || member.platformId,
  }
}

export interface RestExportMember {
  platformId: string
  accountName?: string | null
  groupNickname?: string | null
  aliases?: string[]
}

export interface RestExportMessage {
  senderPlatformId: string
  senderName?: string | null
  timestamp: number
  type: number
  content?: string | null
}

export interface RestSessionExportData {
  members: RestExportMember[]
  messages: RestExportMessage[]
}

export interface RestSessionProvider {
  countSessions(): Awaitable<number>
  listSessions(): Awaitable<RestSessionSummary[]>
  getSession(sessionId: string): Awaitable<RestSessionDetail | null>
  queryMessages(sessionId: string, query: RestMessageQuery): Awaitable<RestMessagePage | null>
  getMembers(sessionId: string): Awaitable<RestSessionMember[] | null>
  getOverview(sessionId: string): Awaitable<RestSessionOverview | null>
  executeReadonlySql(sessionId: string, sql: string): Awaitable<unknown | null>
  getExportData(sessionId: string, limit: number): Awaitable<RestSessionExportData | null>
}

function getSummary(dbManager: DatabaseManager, sessionId: string): RestSessionSummary | null {
  const db = dbManager.open(sessionId)
  if (!db) return null
  const info = getSessionInfo(db)
  if (!info) return null

  return {
    id: sessionId,
    name: info.name,
    platform: info.platform,
    type: info.type,
    groupId: info.groupId || undefined,
    messageCount: info.messageCount,
    memberCount: info.memberCount,
    firstTimestamp: info.firstMessageTs,
    lastTimestamp: info.lastMessageTs,
    importedAt: info.importedAt,
  }
}

function getDetail(dbManager: DatabaseManager, sessionId: string): RestSessionDetail | null {
  const summary = getSummary(dbManager, sessionId)
  if (!summary) return null
  const db = dbManager.open(sessionId)
  if (!db) return null

  return {
    ...summary,
    lastPlatformMessageId: getLastPlatformMessageId(db),
    importedAt: summary.importedAt ?? 0,
  }
}

export function createDatabaseRestSessionProvider(dbManager: DatabaseManager): RestSessionProvider {
  return {
    countSessions: () => dbManager.listSessionIds().length,
    listSessions: () =>
      dbManager
        .listSessionIds()
        .map((sessionId) => getSummary(dbManager, sessionId))
        .filter((session): session is RestSessionSummary => session !== null),
    getSession: (sessionId) => getDetail(dbManager, sessionId),
    queryMessages: (sessionId, query) => {
      const db = dbManager.open(sessionId)
      if (!db) return null
      return queryMessages(db, {
        keyword: query.keyword,
        startTs: query.startTime,
        endTs: query.endTime,
        senderId: query.senderId,
        limit: query.limit,
        offset: query.offset,
      })
    },
    getMembers: (sessionId) => {
      const db = dbManager.open(sessionId)
      return db ? getMembersWithAliases(db).map(normalizeRestSessionMember) : null
    },
    getOverview: (sessionId) => {
      const db = dbManager.open(sessionId)
      if (!db) return null

      const overview = getSessionOverview(db)
      const memberActivity = getMemberActivity(db)
      const typeDistribution = getMessageTypeStats(db)
      const messageTypeDistribution: Record<string, number> = {}
      for (const item of typeDistribution) {
        messageTypeDistribution[String(item.type)] = item.count
      }

      return {
        messageCount: overview.totalMessages,
        memberCount: overview.totalMembers,
        timeRange: {
          start: overview.firstMessageTs ?? 0,
          end: overview.lastMessageTs ?? 0,
        },
        messageTypeDistribution,
        topMembers: memberActivity.slice(0, 10).map((member) => ({
          platformId: member.platformId,
          name: member.name,
          messageCount: member.messageCount,
          percentage: member.percentage,
        })),
      }
    },
    executeReadonlySql: (sessionId, sql) => {
      const db = dbManager.open(sessionId)
      return db ? executeReadonlySql(db, sql) : null
    },
    getExportData: (sessionId, limit) => {
      const db = dbManager.open(sessionId)
      if (!db) return null
      const session = getDetail(dbManager, sessionId)
      const meta = getSessionMeta(db)
      if (!session || !meta) return null

      const members = getMembersWithAliases(db)
      const messages = queryMessages(db, { limit, offset: 0 }).messages

      return {
        members,
        messages,
      }
    },
  }
}
