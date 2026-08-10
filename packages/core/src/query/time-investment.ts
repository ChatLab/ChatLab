import {
  ChatType,
  MessageType,
  type AnnualSummaryCoverage,
  type AnnualSummaryRange,
  type ChatPlatform,
  type TimeInvestmentActivityPoint,
  type TimeInvestmentChatTypeItem,
  type TimeInvestmentMetrics,
  type TimeInvestmentSessionRankItem,
} from '@openchatlab/shared-types'
import type { DatabaseAdapter } from '../interfaces'
import { resolveOwnerMember } from './contact-queries'
import { getSessionMeta, isChatSessionDb } from './session-queries'

const TIME_INVESTMENT_ACTIVITY_GAP_SECONDS = 5 * 60
const TIME_INVESTMENT_TAIL_SECONDS = 60
const TIME_INVESTMENT_SELF_INITIATED_SECONDS = 2 * 60
const TIME_INVESTMENT_CONTEXT_SECONDS = 5 * 60

export interface TimeInvestmentInterval {
  startTs: number
  endTs: number
}

export interface TimeInvestmentMessagePoint {
  ts: number
  senderId: number
}

export interface TimeInvestmentAnalyzedFacts {
  kind: 'analyzed'
  sessionId: string
  sessionName: string
  platform: ChatPlatform
  chatType: ChatType
  availableDataYears: number[]
  investmentIntervals: TimeInvestmentInterval[]
}

export type TimeInvestmentSessionFacts =
  | TimeInvestmentAnalyzedFacts
  | {
      kind: 'not_chat_db' | 'missing_meta' | 'unsupported_type' | 'missing_owner' | 'unresolved_owner' | 'failed'
      availableDataYears: number[]
    }

export interface TimeInvestmentAggregatedData {
  availableDataYears: number[]
  latestDataYear: number | null
  metrics: TimeInvestmentMetrics
  monthlyActivity: TimeInvestmentActivityPoint[]
  dailyActivity: TimeInvestmentActivityPoint[]
  sessionRanking: TimeInvestmentSessionRankItem[]
  chatTypes: TimeInvestmentChatTypeItem[]
  coverage: AnnualSummaryCoverage
}

const EXCLUDED_MESSAGE_TYPES = [MessageType.SYSTEM, MessageType.RECALL]

export function getTimeInvestmentSessionFacts(
  db: DatabaseAdapter,
  sessionId: string,
  range: AnnualSummaryRange
): TimeInvestmentSessionFacts {
  if (!isChatSessionDb(db)) return emptyFacts('not_chat_db')
  const meta = getSessionMeta(db)
  if (!meta) return emptyFacts('missing_meta')
  if (meta.type !== ChatType.PRIVATE && meta.type !== ChatType.GROUP) return emptyFacts('unsupported_type')
  if (!meta.ownerId?.trim()) return emptyFacts('missing_owner')
  const owner = resolveOwnerMember(db)
  if (!owner) return emptyFacts('unresolved_owner')

  const contextStartTs = range.startTs - TIME_INVESTMENT_CONTEXT_SECONDS
  const contextEndTs = range.endTs + TIME_INVESTMENT_CONTEXT_SECONDS
  const points = db
    .prepare(
      `SELECT msg.ts, msg.sender_id as senderId
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       WHERE msg.ts >= ? AND msg.ts <= ?
         AND msg.type NOT IN (${EXCLUDED_MESSAGE_TYPES.join(', ')})
         AND COALESCE(m.account_name, '') != '系统消息'
       ORDER BY msg.ts ASC, msg.id ASC`
    )
    .all(contextStartTs, contextEndTs) as unknown as TimeInvestmentMessagePoint[]
  const availableDataYears = (
    db
      .prepare(
        `SELECT DISTINCT CAST(strftime('%Y', msg.ts, 'unixepoch', 'localtime') AS INTEGER) as year
         FROM message msg
         JOIN member m ON msg.sender_id = m.id
         WHERE msg.sender_id = ?
           AND msg.type NOT IN (${EXCLUDED_MESSAGE_TYPES.join(', ')})
           AND COALESCE(m.account_name, '') != '系统消息'
         ORDER BY year DESC`
      )
      .all(owner.id) as Array<{ year: number }>
  ).map((row) => row.year)
  const investmentIntervals = estimateTimeInvestmentIntervals(points, owner.id, range)

  return {
    kind: 'analyzed',
    sessionId,
    sessionName: meta.name,
    platform: meta.platform,
    chatType: meta.type,
    availableDataYears,
    investmentIntervals,
  }
}

export function estimateTimeInvestmentIntervals(
  points: TimeInvestmentMessagePoint[],
  ownerId: number,
  range: Pick<AnnualSummaryRange, 'startTs' | 'endTs'>
): TimeInvestmentInterval[] {
  const ordered = [...points].sort((a, b) => a.ts - b.ts)
  const ownerPoints = ordered.filter((point) => point.senderId === ownerId)
  if (ownerPoints.length === 0) return []

  const clusters: TimeInvestmentMessagePoint[][] = []
  let current: TimeInvestmentMessagePoint[] = []
  for (const point of ownerPoints) {
    const previous = current.at(-1)
    if (previous && point.ts - previous.ts > TIME_INVESTMENT_ACTIVITY_GAP_SECONDS) {
      clusters.push(current)
      current = []
    }
    current.push(point)
  }
  if (current.length > 0) clusters.push(current)

  const investment: TimeInvestmentInterval[] = []
  for (const cluster of clusters) {
    const first = cluster[0]
    const last = cluster.at(-1)!
    const trigger = findLastOtherPoint(ordered, ownerId, first.ts - TIME_INVESTMENT_CONTEXT_SECONDS, first.ts)
    const reply = findLastOtherPoint(ordered, ownerId, last.ts + 1, last.ts + TIME_INVESTMENT_CONTEXT_SECONDS + 1)
    const startTs = trigger?.ts ?? first.ts
    let endTs = last.ts + TIME_INVESTMENT_TAIL_SECONDS
    if (reply) {
      endTs = Math.max(
        endTs,
        Math.min(last.ts + TIME_INVESTMENT_CONTEXT_SECONDS, reply.ts + TIME_INVESTMENT_TAIL_SECONDS)
      )
    }
    if (cluster.length === 1 && !trigger) {
      endTs = Math.max(endTs, first.ts + TIME_INVESTMENT_SELF_INITIATED_SECONDS)
    }
    const investmentInterval = clipInterval({ startTs, endTs }, range)
    if (investmentInterval) investment.push(investmentInterval)
  }

  return mergeIntervals(investment)
}

export function aggregateTimeInvestmentFacts(
  facts: TimeInvestmentSessionFacts[],
  range: AnnualSummaryRange
): TimeInvestmentAggregatedData {
  const analyzed = facts.filter((item): item is TimeInvestmentAnalyzedFacts => item.kind === 'analyzed')
  const availableDataYears = [...new Set(analyzed.flatMap((item) => item.availableDataYears))].sort((a, b) => b - a)
  const investmentIntervals = mergeIntervals(analyzed.flatMap((item) => item.investmentIntervals))
  const estimatedSeconds = sumIntervals(investmentIntervals)
  const dailyEstimated = splitIntervalsByLocalDay(investmentIntervals)
  const dailyActivity = buildDailyActivity(dailyEstimated)
  const allocations = allocateIntervalsBySession(analyzed)
  const sessionRanking = analyzed
    .map((item) => {
      const seconds = normalizeSeconds(allocations.get(item.sessionId) ?? 0)
      return {
        sessionId: item.sessionId,
        name: item.sessionName,
        platform: item.platform,
        type: item.chatType,
        seconds,
        share: percentage(seconds, estimatedSeconds),
      }
    })
    .filter((item) => item.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name))
  const chatTypes = buildChatTypeBreakdown(sessionRanking, estimatedSeconds)

  return {
    availableDataYears,
    latestDataYear: availableDataYears[0] ?? null,
    metrics: {
      estimatedSeconds,
      activeDayCount: dailyActivity.length,
      averagePerActiveDaySeconds: dailyActivity.length ? Math.round(estimatedSeconds / dailyActivity.length) : 0,
    },
    monthlyActivity: buildMonthlyActivity(range, dailyEstimated),
    dailyActivity,
    sessionRanking,
    chatTypes,
    coverage: buildCoverage(facts),
  }
}

function mergeIntervals(intervals: TimeInvestmentInterval[]): TimeInvestmentInterval[] {
  const ordered = intervals
    .filter((item) => Number.isFinite(item.startTs) && Number.isFinite(item.endTs) && item.endTs > item.startTs)
    .sort((a, b) => a.startTs - b.startTs || a.endTs - b.endTs)
  const merged: TimeInvestmentInterval[] = []
  for (const interval of ordered) {
    const previous = merged.at(-1)
    if (!previous || interval.startTs > previous.endTs) merged.push({ ...interval })
    else previous.endTs = Math.max(previous.endTs, interval.endTs)
  }
  return merged
}

function findLastOtherPoint(
  points: TimeInvestmentMessagePoint[],
  ownerId: number,
  startTs: number,
  endTsExclusive: number
): TimeInvestmentMessagePoint | undefined {
  for (let index = lowerBoundByTimestamp(points, endTsExclusive) - 1; index >= 0; index--) {
    const point = points[index]
    if (point.ts < startTs) break
    if (point.senderId !== ownerId) return point
  }
  return undefined
}

function lowerBoundByTimestamp(points: TimeInvestmentMessagePoint[], targetTs: number): number {
  let low = 0
  let high = points.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (points[middle].ts < targetTs) low = middle + 1
    else high = middle
  }
  return low
}

function clipInterval(
  interval: TimeInvestmentInterval,
  range: Pick<AnnualSummaryRange, 'startTs' | 'endTs'>
): TimeInvestmentInterval | null {
  const startTs = Math.max(interval.startTs, range.startTs)
  const endTs = Math.min(interval.endTs, range.endTs + 1)
  return endTs > startTs ? { startTs, endTs } : null
}

function sumIntervals(intervals: TimeInvestmentInterval[]): number {
  return normalizeSeconds(intervals.reduce((sum, item) => sum + item.endTs - item.startTs, 0))
}

function splitIntervalsByLocalDay(intervals: TimeInvestmentInterval[]): Map<string, number> {
  const result = new Map<string, number>()
  for (const interval of intervals) {
    let cursor = interval.startTs
    while (cursor < interval.endTs) {
      const current = new Date(cursor * 1000)
      const key = formatLocalDate(current)
      const nextMidnight = Math.floor(
        new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1).getTime() / 1000
      )
      const segmentEnd = Math.min(interval.endTs, nextMidnight)
      result.set(key, (result.get(key) ?? 0) + segmentEnd - cursor)
      cursor = segmentEnd
    }
  }
  return result
}

function buildDailyActivity(estimated: Map<string, number>): TimeInvestmentActivityPoint[] {
  return [...estimated.keys()]
    .sort()
    .map((key) => ({
      key,
      estimatedSeconds: normalizeSeconds(estimated.get(key) ?? 0),
    }))
    .filter((item) => item.estimatedSeconds > 0)
}

function buildMonthlyActivity(
  range: AnnualSummaryRange,
  dailyEstimated: Map<string, number>
): TimeInvestmentActivityPoint[] {
  const estimated = groupDaysByMonth(dailyEstimated)
  const points: TimeInvestmentActivityPoint[] = []
  const cursor = new Date(range.startTs * 1000)
  cursor.setDate(1)
  cursor.setHours(0, 0, 0, 0)
  const end = new Date(range.endTs * 1000)
  end.setDate(1)
  end.setHours(0, 0, 0, 0)
  while (cursor <= end) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
    points.push({
      key,
      estimatedSeconds: normalizeSeconds(estimated.get(key) ?? 0),
    })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return points
}

function groupDaysByMonth(days: Map<string, number>): Map<string, number> {
  const months = new Map<string, number>()
  for (const [day, seconds] of days) {
    const month = day.slice(0, 7)
    months.set(month, (months.get(month) ?? 0) + seconds)
  }
  return months
}

function allocateIntervalsBySession(facts: TimeInvestmentAnalyzedFacts[]): Map<string, number> {
  const events = facts
    .flatMap((item) =>
      item.investmentIntervals.flatMap((interval) => [
        { ts: interval.startTs, sessionId: item.sessionId, delta: 1 },
        { ts: interval.endTs, sessionId: item.sessionId, delta: -1 },
      ])
    )
    .sort((a, b) => a.ts - b.ts)
  const allocations = new Map<string, number>()
  const active = new Set<string>()
  let previousTs: number | null = null
  let index = 0
  while (index < events.length) {
    const ts = events[index].ts
    if (previousTs !== null && ts > previousTs && active.size > 0) {
      const share = (ts - previousTs) / active.size
      active.forEach((sessionId) => allocations.set(sessionId, (allocations.get(sessionId) ?? 0) + share))
    }
    while (index < events.length && events[index].ts === ts) {
      const event = events[index]
      if (event.delta > 0) active.add(event.sessionId)
      else active.delete(event.sessionId)
      index++
    }
    previousTs = ts
  }
  return allocations
}

function buildChatTypeBreakdown(
  sessions: TimeInvestmentSessionRankItem[],
  totalSeconds: number
): TimeInvestmentChatTypeItem[] {
  const totals = new Map<ChatType, number>()
  sessions.forEach((item) => totals.set(item.type, (totals.get(item.type) ?? 0) + item.seconds))
  return [...totals.entries()]
    .map(([type, seconds]) => ({ type, seconds: normalizeSeconds(seconds), share: percentage(seconds, totalSeconds) }))
    .sort((a, b) => b.seconds - a.seconds)
}

function buildCoverage(facts: TimeInvestmentSessionFacts[]): AnnualSummaryCoverage {
  const coverage: AnnualSummaryCoverage = {
    totalSessions: 0,
    analyzedSessions: 0,
    missingOwnerSessions: 0,
    unresolvedOwnerSessions: 0,
    failedSessions: 0,
  }
  for (const item of facts) {
    if (item.kind === 'not_chat_db' || item.kind === 'missing_meta' || item.kind === 'unsupported_type') continue
    coverage.totalSessions++
    if (item.kind === 'analyzed') coverage.analyzedSessions++
    else if (item.kind === 'missing_owner') coverage.missingOwnerSessions++
    else if (item.kind === 'unresolved_owner') coverage.unresolvedOwnerSessions++
    else coverage.failedSessions++
  }
  return coverage
}

function emptyFacts(kind: Exclude<TimeInvestmentSessionFacts['kind'], 'analyzed'>): TimeInvestmentSessionFacts {
  return { kind, availableDataYears: [] }
}

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function percentage(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 10_000) / 100 : 0
}

function normalizeSeconds(value: number): number {
  return Math.round(value * 1_000) / 1_000
}
