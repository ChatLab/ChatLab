import type { DatabaseAdapter } from '../interfaces'
import { nonSystemMessageCondition } from './contact-queries'

export interface CrossChatStatisticsQueryOptions {
  startTs?: number | null
  endTs?: number | null
}

export interface CrossChatMemberActivityFacts {
  memberId: number
  platformId: string
  memberName: string
  messageCount: number
  activeDays: number
  firstMessageTs: number | null
  lastMessageTs: number | null
}

export interface CrossChatSessionActivityFacts {
  totalMessages: number
  activeDays: number
  activeMembers: number
  firstMessageTs: number | null
  lastMessageTs: number | null
  dataEarliestMessageTs: number | null
  dataLatestMessageTs: number | null
  activeDayKeys: string[]
  members: CrossChatMemberActivityFacts[]
}

/**
 * 返回一个会话在指定时间范围内的确定性活动事实。
 * 查询只读取计数、成员和时间，不物化聊天正文；跨会话聚合由 Node Runtime 负责。
 */
export function getCrossChatSessionActivityFacts(
  db: DatabaseAdapter,
  options: CrossChatStatisticsQueryOptions = {}
): CrossChatSessionActivityFacts {
  const timeFilter = createTimeFilter('msg', options)
  const messageCondition = nonSystemMessageCondition(db, 'msg', 'm')
  const summary = db
    .prepare(
      `SELECT
         COUNT(*) as totalMessages,
         COUNT(DISTINCT strftime('%Y-%m-%d', msg.ts, 'unixepoch', 'localtime')) as activeDays,
         COUNT(DISTINCT msg.sender_id) as activeMembers,
         MIN(msg.ts) as firstMessageTs,
         MAX(msg.ts) as lastMessageTs
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       WHERE ${messageCondition}${timeFilter.sql}`
    )
    .get(...timeFilter.params) as
    | {
        totalMessages: number
        activeDays: number
        activeMembers: number
        firstMessageTs: number | null
        lastMessageTs: number | null
      }
    | undefined

  const members = db
    .prepare(
      `SELECT
         msg.sender_id as memberId,
         m.platform_id as platformId,
         COALESCE(m.group_nickname, m.account_name, m.platform_id) as memberName,
         COUNT(*) as messageCount,
         COUNT(DISTINCT strftime('%Y-%m-%d', msg.ts, 'unixepoch', 'localtime')) as activeDays,
         MIN(msg.ts) as firstMessageTs,
         MAX(msg.ts) as lastMessageTs
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       WHERE ${messageCondition}${timeFilter.sql}
       GROUP BY msg.sender_id, m.platform_id, m.group_nickname, m.account_name
       ORDER BY msg.sender_id`
    )
    .all(...timeFilter.params) as unknown as CrossChatMemberActivityFacts[]

  const dataRange = db
    .prepare(
      `SELECT MIN(msg.ts) as firstMessageTs, MAX(msg.ts) as lastMessageTs
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       WHERE ${messageCondition}`
    )
    .get() as { firstMessageTs: number | null; lastMessageTs: number | null } | undefined
  const activeDayKeys = (
    db
      .prepare(
        `SELECT DISTINCT strftime('%Y-%m-%d', msg.ts, 'unixepoch', 'localtime') as activeDay
         FROM message msg
         JOIN member m ON msg.sender_id = m.id
         WHERE ${messageCondition}${timeFilter.sql}
         ORDER BY activeDay`
      )
      .all(...timeFilter.params) as Array<{ activeDay: string }>
  ).map((row) => row.activeDay)

  return {
    totalMessages: summary?.totalMessages ?? 0,
    activeDays: summary?.activeDays ?? 0,
    activeMembers: summary?.activeMembers ?? 0,
    firstMessageTs: summary?.firstMessageTs ?? null,
    lastMessageTs: summary?.lastMessageTs ?? null,
    dataEarliestMessageTs: dataRange?.firstMessageTs ?? null,
    dataLatestMessageTs: dataRange?.lastMessageTs ?? null,
    activeDayKeys,
    members,
  }
}

function createTimeFilter(alias: string, options: CrossChatStatisticsQueryOptions): { sql: string; params: number[] } {
  const clauses: string[] = []
  const params: number[] = []
  if (typeof options.startTs === 'number') {
    clauses.push(`${alias}.ts >= ?`)
    params.push(options.startTs)
  }
  if (typeof options.endTs === 'number') {
    clauses.push(`${alias}.ts <= ?`)
    params.push(options.endTs)
  }
  return {
    sql: clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : '',
    params,
  }
}
