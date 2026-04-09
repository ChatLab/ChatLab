/**
 * 关系分析模块（私聊专属）
 * 基于会话索引统计双方的主动发起、收尾、破冰、响应时延、锲而不舍行为
 */

import { openDatabase, type TimeFilter } from '../../core'

interface MemberMonthCount {
  memberId: number
  name: string
  initiateCount: number
  closeCount: number
}

export interface RelationshipMonthStats {
  month: string
  members: MemberMonthCount[]
  totalSessions: number
}

export interface IceBreakerItem {
  month: string
  memberId: number
  name: string
  count: number
}

export interface ResponseLatencyMember {
  memberId: number
  name: string
  avgResponseTime: number
  totalResponses: number
}

export interface PerseveranceMember {
  memberId: number
  name: string
  totalDoubleTexts: number
}

export interface MonthlyResponseLatency {
  month: string
  members: Array<{
    memberId: number
    name: string
    avgResponseTime: number
    responseCount: number
  }>
}

export interface MonthlyPerseverance {
  month: string
  members: Array<{
    memberId: number
    name: string
    doubleTextCount: number
  }>
}

export interface RelationshipOptions {
  perseveranceThreshold?: number
}

export interface RelationshipStats {
  months: RelationshipMonthStats[]
  members: Array<{
    memberId: number
    name: string
    totalInitiateCount: number
    totalCloseCount: number
  }>
  totalSessions: number
  hasSessionIndex: boolean
  iceBreakers: IceBreakerItem[]
  totalIceBreaks: number
  responseLatency: ResponseLatencyMember[]
  perseverance: PerseveranceMember[]
  totalDoubleTexts: number
  monthlyResponseLatency: MonthlyResponseLatency[]
  monthlyPerseverance: MonthlyPerseverance[]
  perseveranceThreshold: number
}

const ICE_BREAK_THRESHOLD = 24 * 60 * 60
const DEFAULT_PERSEVERANCE_THRESHOLD = 300 // 5 minutes

export function getRelationshipStats(
  sessionId: string,
  filter?: TimeFilter,
  options?: RelationshipOptions
): RelationshipStats {
  const perseveranceThreshold = options?.perseveranceThreshold ?? DEFAULT_PERSEVERANCE_THRESHOLD
  const db = openDatabase(sessionId)
  const emptyResult: RelationshipStats = {
    months: [],
    members: [],
    totalSessions: 0,
    hasSessionIndex: false,
    iceBreakers: [],
    totalIceBreaks: 0,
    responseLatency: [],
    perseverance: [],
    totalDoubleTexts: 0,
    monthlyResponseLatency: [],
    monthlyPerseverance: [],
    perseveranceThreshold,
  }

  if (!db) return emptyResult

  const sessionCount = db.prepare('SELECT COUNT(*) as count FROM chat_session').get() as { count: number } | undefined
  if (!sessionCount || sessionCount.count === 0) {
    return emptyResult
  }

  const timeConditions: string[] = []
  const params: (number | string)[] = []

  if (filter?.startTs !== undefined) {
    timeConditions.push('cs.start_ts >= ?')
    params.push(filter.startTs)
  }
  if (filter?.endTs !== undefined) {
    timeConditions.push('cs.start_ts <= ?')
    params.push(filter.endTs)
  }

  const whereClause = timeConditions.length > 0 ? `WHERE ${timeConditions.join(' AND ')}` : ''

  // ==================== Session-level ====================
  const sessionRows = db
    .prepare(
      `
      SELECT
        cs.id AS session_id,
        cs.start_ts,
        cs.end_ts,
        (
          SELECT m.sender_id
          FROM message_context mc
          JOIN message m ON m.id = mc.message_id
          WHERE mc.session_id = cs.id
          ORDER BY m.ts ASC, m.id ASC
          LIMIT 1
        ) AS initiator_id,
        (
          SELECT m.sender_id
          FROM message_context mc
          JOIN message m ON m.id = mc.message_id
          WHERE mc.session_id = cs.id
          ORDER BY m.ts DESC, m.id DESC
          LIMIT 1
        ) AS closer_id
      FROM chat_session cs
      ${whereClause}
      ORDER BY cs.start_ts ASC
      `
    )
    .all(...params) as Array<{
    session_id: number
    start_ts: number
    end_ts: number
    initiator_id: number | null
    closer_id: number | null
  }>

  const memberNames = new Map<number, string>()
  const memberRows = db
    .prepare('SELECT id, COALESCE(group_nickname, account_name, platform_id) as name FROM member')
    .all() as Array<{ id: number; name: string }>
  for (const row of memberRows) {
    memberNames.set(row.id, row.name)
  }

  const monthMap = new Map<
    string,
    { initiateMap: Map<number, number>; closeMap: Map<number, number>; totalSessions: number }
  >()
  const memberInitTotals = new Map<number, number>()
  const memberCloseTotals = new Map<number, number>()
  const iceBreakMap = new Map<string, Map<number, number>>()
  let totalIceBreaks = 0
  let prevEndTs: number | null = null

  for (const row of sessionRows) {
    const month = toLocalMonth(row.start_ts)

    if (!monthMap.has(month)) {
      monthMap.set(month, { initiateMap: new Map(), closeMap: new Map(), totalSessions: 0 })
    }
    const ms = monthMap.get(month)!
    ms.totalSessions++

    if (row.initiator_id !== null) {
      ms.initiateMap.set(row.initiator_id, (ms.initiateMap.get(row.initiator_id) ?? 0) + 1)
      memberInitTotals.set(row.initiator_id, (memberInitTotals.get(row.initiator_id) ?? 0) + 1)
    }

    if (row.closer_id !== null) {
      ms.closeMap.set(row.closer_id, (ms.closeMap.get(row.closer_id) ?? 0) + 1)
      memberCloseTotals.set(row.closer_id, (memberCloseTotals.get(row.closer_id) ?? 0) + 1)
    }

    if (prevEndTs !== null && row.initiator_id !== null) {
      if (row.start_ts - prevEndTs > ICE_BREAK_THRESHOLD) {
        if (!iceBreakMap.has(month)) iceBreakMap.set(month, new Map())
        const mMap = iceBreakMap.get(month)!
        mMap.set(row.initiator_id, (mMap.get(row.initiator_id) ?? 0) + 1)
        totalIceBreaks++
      }
    }
    prevEndTs = row.end_ts
  }

  const allMemberIds = new Set<number>()
  for (const id of memberInitTotals.keys()) allMemberIds.add(id)
  for (const id of memberCloseTotals.keys()) allMemberIds.add(id)

  const monthKeys = Array.from(monthMap.keys()).sort((a, b) => b.localeCompare(a))
  const months: RelationshipMonthStats[] = monthKeys.map((month) => {
    const ms = monthMap.get(month)!
    const members: MemberMonthCount[] = Array.from(allMemberIds).map((memberId) => ({
      memberId,
      name: memberNames.get(memberId) ?? `Unknown(${memberId})`,
      initiateCount: ms.initiateMap.get(memberId) ?? 0,
      closeCount: ms.closeMap.get(memberId) ?? 0,
    }))
    return { month, members, totalSessions: ms.totalSessions }
  })

  const totalSessions = sessionRows.length

  const members = Array.from(allMemberIds)
    .map((memberId) => ({
      memberId,
      name: memberNames.get(memberId) ?? `Unknown(${memberId})`,
      totalInitiateCount: memberInitTotals.get(memberId) ?? 0,
      totalCloseCount: memberCloseTotals.get(memberId) ?? 0,
    }))
    .sort((a, b) => b.totalInitiateCount - a.totalInitiateCount)

  const iceBreakers: IceBreakerItem[] = []
  for (const month of monthKeys) {
    const mMap = iceBreakMap.get(month)
    if (!mMap) continue
    for (const [memberId, count] of mMap) {
      iceBreakers.push({ month, memberId, name: memberNames.get(memberId) ?? `Unknown(${memberId})`, count })
    }
  }

  // ==================== Message-level ====================
  const sessionIdList = sessionRows.map((r) => r.session_id)
  const msgStats = queryMessageLevelStats(db, sessionIdList, memberNames, perseveranceThreshold)

  return {
    months,
    members,
    totalSessions,
    hasSessionIndex: true,
    iceBreakers,
    totalIceBreaks,
    ...msgStats,
    perseveranceThreshold,
  }
}

function queryMessageLevelStats(
  db: ReturnType<typeof openDatabase>,
  sessionIds: number[],
  memberNames: Map<number, string>,
  perseveranceThreshold: number
): {
  responseLatency: ResponseLatencyMember[]
  perseverance: PerseveranceMember[]
  totalDoubleTexts: number
  monthlyResponseLatency: MonthlyResponseLatency[]
  monthlyPerseverance: MonthlyPerseverance[]
} {
  const empty = {
    responseLatency: [],
    perseverance: [],
    totalDoubleTexts: 0,
    monthlyResponseLatency: [],
    monthlyPerseverance: [],
  }
  if (!db || sessionIds.length === 0) return empty

  const BATCH_SIZE = 500

  // Overall
  const responseTotals = new Map<number, { sum: number; count: number }>()
  const dtTotals = new Map<number, number>()

  // Monthly
  const monthlyRespMap = new Map<string, Map<number, { sum: number; count: number }>>()
  const monthlyDtMap = new Map<string, Map<number, number>>()

  for (let i = 0; i < sessionIds.length; i += BATCH_SIZE) {
    const batch = sessionIds.slice(i, i + BATCH_SIZE)
    const placeholders = batch.map(() => '?').join(',')

    // 响应时延（overall + monthly）
    const latencyRows = db
      .prepare(
        `
        WITH msg_lag AS (
          SELECT
            m.sender_id,
            m.ts,
            LAG(m.sender_id) OVER (PARTITION BY mc.session_id ORDER BY m.ts, m.id) AS prev_sender_id,
            LAG(m.ts) OVER (PARTITION BY mc.session_id ORDER BY m.ts, m.id) AS prev_ts
          FROM message_context mc
          JOIN message m ON m.id = mc.message_id
          WHERE mc.session_id IN (${placeholders})
            AND m.type = 0
        )
        SELECT
          strftime('%Y-%m', datetime(ts, 'unixepoch', 'localtime')) AS month,
          sender_id AS responder_id,
          SUM(ts - prev_ts) AS total_time,
          COUNT(*) AS response_count
        FROM msg_lag
        WHERE prev_sender_id IS NOT NULL AND sender_id != prev_sender_id
        GROUP BY month, responder_id
        `
      )
      .all(...batch) as Array<{
      month: string
      responder_id: number
      total_time: number
      response_count: number
    }>

    for (const row of latencyRows) {
      // overall
      const existing = responseTotals.get(row.responder_id)
      if (existing) {
        existing.sum += row.total_time
        existing.count += row.response_count
      } else {
        responseTotals.set(row.responder_id, { sum: row.total_time, count: row.response_count })
      }

      // monthly
      if (!monthlyRespMap.has(row.month)) monthlyRespMap.set(row.month, new Map())
      const mMap = monthlyRespMap.get(row.month)!
      const mExisting = mMap.get(row.responder_id)
      if (mExisting) {
        mExisting.sum += row.total_time
        mExisting.count += row.response_count
      } else {
        mMap.set(row.responder_id, { sum: row.total_time, count: row.response_count })
      }
    }

    // 锲而不舍（overall + monthly），带时间阈值
    const dtRows = db
      .prepare(
        `
        WITH msg_lag AS (
          SELECT
            m.sender_id,
            m.ts,
            LAG(m.sender_id) OVER (PARTITION BY mc.session_id ORDER BY m.ts, m.id) AS prev_sender_id,
            LAG(m.ts) OVER (PARTITION BY mc.session_id ORDER BY m.ts, m.id) AS prev_ts
          FROM message_context mc
          JOIN message m ON m.id = mc.message_id
          WHERE mc.session_id IN (${placeholders})
            AND m.type = 0
        )
        SELECT
          strftime('%Y-%m', datetime(ts, 'unixepoch', 'localtime')) AS month,
          sender_id,
          COUNT(*) AS double_text_count
        FROM msg_lag
        WHERE prev_sender_id IS NOT NULL
          AND sender_id = prev_sender_id
          AND (ts - prev_ts) >= ?
        GROUP BY month, sender_id
        `
      )
      .all(...batch, perseveranceThreshold) as Array<{
      month: string
      sender_id: number
      double_text_count: number
    }>

    for (const row of dtRows) {
      // overall
      dtTotals.set(row.sender_id, (dtTotals.get(row.sender_id) ?? 0) + row.double_text_count)

      // monthly
      if (!monthlyDtMap.has(row.month)) monthlyDtMap.set(row.month, new Map())
      const mMap = monthlyDtMap.get(row.month)!
      mMap.set(row.sender_id, (mMap.get(row.sender_id) ?? 0) + row.double_text_count)
    }
  }

  // Build overall results
  const responseLatency: ResponseLatencyMember[] = Array.from(responseTotals.entries())
    .map(([memberId, { sum, count }]) => ({
      memberId,
      name: memberNames.get(memberId) ?? `Unknown(${memberId})`,
      avgResponseTime: Math.round(sum / count),
      totalResponses: count,
    }))
    .sort((a, b) => a.avgResponseTime - b.avgResponseTime)

  let totalDoubleTexts = 0
  const perseverance: PerseveranceMember[] = Array.from(dtTotals.entries())
    .map(([memberId, count]) => {
      totalDoubleTexts += count
      return {
        memberId,
        name: memberNames.get(memberId) ?? `Unknown(${memberId})`,
        totalDoubleTexts: count,
      }
    })
    .sort((a, b) => b.totalDoubleTexts - a.totalDoubleTexts)

  // Build monthly response latency
  const monthlyResponseLatency: MonthlyResponseLatency[] = Array.from(monthlyRespMap.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, mMap]) => ({
      month,
      members: Array.from(mMap.entries())
        .map(([memberId, { sum, count }]) => ({
          memberId,
          name: memberNames.get(memberId) ?? `Unknown(${memberId})`,
          avgResponseTime: Math.round(sum / count),
          responseCount: count,
        }))
        .sort((a, b) => a.avgResponseTime - b.avgResponseTime),
    }))

  // Build monthly perseverance
  const monthlyPerseverance: MonthlyPerseverance[] = Array.from(monthlyDtMap.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, mMap]) => ({
      month,
      members: Array.from(mMap.entries())
        .map(([memberId, count]) => ({
          memberId,
          name: memberNames.get(memberId) ?? `Unknown(${memberId})`,
          doubleTextCount: count,
        }))
        .sort((a, b) => b.doubleTextCount - a.doubleTextCount),
    }))

  return { responseLatency, perseverance, totalDoubleTexts, monthlyResponseLatency, monthlyPerseverance }
}

function toLocalMonth(ts: number): string {
  const d = new Date(ts * 1000)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}
