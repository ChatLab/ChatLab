/**
 * Private-chat journey analysis.
 *
 * All results are deterministic local aggregates. Message content never
 * leaves the database and is not returned to callers.
 */

import type { TimeFilter } from '@openchatlab/shared-types'
import type { DatabaseAdapter } from '../../interfaces'
import { buildSystemMessageFilter, buildTimeFilter, hasTable } from '../filters'
import { hasSessionIndex } from '../session-queries'

const SILENCE_THRESHOLD_SECONDS = 24 * 60 * 60

export interface JourneyMonth {
  month: string
  messageCount: number
  activeDays: number
  segmentCount: number | null
}

export interface JourneyYear {
  year: number
  messageCount: number
  activeDays: number
  activeMonths: number
  peakMonth: string
  peakMonthMessageCount: number
}

export interface JourneyMember {
  memberId: number
  name: string
}

export interface JourneySegment {
  segmentId: number
  startTs: number
  endTs: number
  durationSeconds: number
  messageCount: number
  initiator: JourneyMember | null
}

export interface JourneySilence {
  previousSegmentId: number
  nextSegmentId: number
  startTs: number
  endTs: number
  durationSeconds: number
  reopenedBy: JourneyMember | null
}

export interface JourneyRange {
  firstMessageTs: number
  lastMessageTs: number
  spanDays: number
  spanMonths: number
  activeDays: number
  activeMonths: number
}

export interface JourneyStats {
  range: JourneyRange | null
  hasSessionIndex: boolean
  months: JourneyMonth[]
  years: JourneyYear[]
  peakMonth: JourneyMonth | null
  longestSegment: JourneySegment | null
  longestSilence: JourneySilence | null
}

interface MonthlyRow {
  month: string
  messageCount: number
  activeDays: number
  firstMessageTs: number
  lastMessageTs: number
}

interface SegmentRow {
  segmentId: number
  startTs: number
  endTs: number
  messageCount: number
  startMonth: string
  initiatorId: number | null
  initiatorName: string | null
}

const EMPTY_RESULT: JourneyStats = {
  range: null,
  hasSessionIndex: false,
  months: [],
  years: [],
  peakMonth: null,
  longestSegment: null,
  longestSilence: null,
}

export function getJourneyStats(db: DatabaseAdapter, filter?: TimeFilter): JourneyStats {
  const effectiveFilter = filter
    ? {
        startTs: filter.startTs,
        endTs: filter.endTs,
      }
    : undefined
  const monthlyRows = queryMonthlyRows(db, effectiveFilter)
  if (monthlyRows.length === 0) return { ...EMPTY_RESULT }

  const indexAvailable = hasSessionIndex(db) && hasTable(db, 'message_context')
  const segmentRows = indexAvailable ? querySegmentRows(db, effectiveFilter) : []
  const segmentCountByMonth = new Map<string, number>()
  for (const segment of segmentRows) {
    segmentCountByMonth.set(segment.startMonth, (segmentCountByMonth.get(segment.startMonth) ?? 0) + 1)
  }

  const firstRow = monthlyRows[0]
  const lastRow = monthlyRows[monthlyRows.length - 1]
  const monthsByKey = new Map(monthlyRows.map((row) => [row.month, row]))
  const months = enumerateMonths(firstRow.month, lastRow.month).map<JourneyMonth>((month) => {
    const row = monthsByKey.get(month)
    return {
      month,
      messageCount: row?.messageCount ?? 0,
      activeDays: row?.activeDays ?? 0,
      segmentCount: indexAvailable ? (segmentCountByMonth.get(month) ?? 0) : null,
    }
  })

  const peakMonth = selectPeakMonth(months)
  const years = buildYears(months)
  const firstMessageTs = firstRow.firstMessageTs
  const lastMessageTs = lastRow.lastMessageTs

  return {
    range: {
      firstMessageTs,
      lastMessageTs,
      spanDays: Math.max(1, Math.floor((lastMessageTs - firstMessageTs) / 86400) + 1),
      spanMonths: months.length,
      activeDays: monthlyRows.reduce((sum, row) => sum + row.activeDays, 0),
      activeMonths: monthlyRows.length,
    },
    hasSessionIndex: indexAvailable,
    months,
    years,
    peakMonth,
    longestSegment: selectLongestSegment(segmentRows),
    longestSilence: selectLongestSilence(segmentRows),
  }
}

function queryMonthlyRows(db: DatabaseAdapter, filter?: TimeFilter): MonthlyRow[] {
  const { clause, params } = buildTimeFilter(filter, 'msg')
  const whereClause = buildSystemMessageFilter(clause)

  return db
    .prepare(
      `SELECT
         strftime('%Y-%m', msg.ts, 'unixepoch', 'localtime') AS month,
         COUNT(*) AS messageCount,
         COUNT(DISTINCT strftime('%Y-%m-%d', msg.ts, 'unixepoch', 'localtime')) AS activeDays,
         MIN(msg.ts) AS firstMessageTs,
         MAX(msg.ts) AS lastMessageTs
       FROM message msg
       JOIN member m ON m.id = msg.sender_id
       ${whereClause}
       GROUP BY month
       ORDER BY month ASC`
    )
    .all(...params) as unknown as MonthlyRow[]
}

function querySegmentRows(db: DatabaseAdapter, filter?: TimeFilter): SegmentRow[] {
  const { clause, params } = buildTimeFilter(filter, 'msg')
  const whereClause = buildSystemMessageFilter(clause)

  return db
    .prepare(
      `WITH filtered_messages AS (
         SELECT
           mc.segment_id AS segmentId,
           msg.id AS messageId,
           msg.sender_id AS senderId,
           msg.ts AS ts,
           COALESCE(m.group_nickname, m.account_name, m.platform_id) AS senderName,
           ROW_NUMBER() OVER (
             PARTITION BY mc.segment_id
             ORDER BY msg.ts ASC, msg.id ASC
           ) AS rowNumber
         FROM message_context mc
         JOIN segment s ON s.id = mc.segment_id
         JOIN message msg ON msg.id = mc.message_id
         JOIN member m ON m.id = msg.sender_id
         ${whereClause}
       ),
       segment_summary AS (
         SELECT
           segmentId,
           MIN(ts) AS startTs,
           MAX(ts) AS endTs,
           COUNT(*) AS messageCount
         FROM filtered_messages
         GROUP BY segmentId
       )
       SELECT
         summary.segmentId,
         summary.startTs,
         summary.endTs,
         summary.messageCount,
         strftime('%Y-%m', summary.startTs, 'unixepoch', 'localtime') AS startMonth,
         firstMessage.senderId AS initiatorId,
         firstMessage.senderName AS initiatorName
       FROM segment_summary summary
       LEFT JOIN filtered_messages firstMessage
         ON firstMessage.segmentId = summary.segmentId AND firstMessage.rowNumber = 1
       ORDER BY summary.startTs ASC, summary.segmentId ASC`
    )
    .all(...params) as unknown as SegmentRow[]
}

function enumerateMonths(firstMonth: string, lastMonth: string): string[] {
  const [firstYear, firstMonthNumber] = firstMonth.split('-').map(Number)
  const [lastYear, lastMonthNumber] = lastMonth.split('-').map(Number)
  const firstIndex = firstYear * 12 + firstMonthNumber - 1
  const lastIndex = lastYear * 12 + lastMonthNumber - 1
  const months: string[] = []

  for (let index = firstIndex; index <= lastIndex; index++) {
    const year = Math.floor(index / 12)
    const month = (index % 12) + 1
    months.push(`${year}-${String(month).padStart(2, '0')}`)
  }
  return months
}

function selectPeakMonth(months: JourneyMonth[]): JourneyMonth | null {
  let peak: JourneyMonth | null = null
  for (const month of months) {
    if (!peak || month.messageCount > peak.messageCount) peak = month
  }
  return peak
}

function buildYears(months: JourneyMonth[]): JourneyYear[] {
  const grouped = new Map<number, JourneyMonth[]>()
  for (const month of months) {
    const year = Number.parseInt(month.month.slice(0, 4), 10)
    const values = grouped.get(year)
    if (values) values.push(month)
    else grouped.set(year, [month])
  }

  return Array.from(grouped.entries()).map(([year, values]) => {
    const activeValues = values.filter((value) => value.messageCount > 0)
    const peak = selectPeakMonth(values)!
    return {
      year,
      messageCount: values.reduce((sum, value) => sum + value.messageCount, 0),
      activeDays: values.reduce((sum, value) => sum + value.activeDays, 0),
      activeMonths: activeValues.length,
      peakMonth: peak.month,
      peakMonthMessageCount: peak.messageCount,
    }
  })
}

function toJourneySegment(row: SegmentRow): JourneySegment {
  return {
    segmentId: row.segmentId,
    startTs: row.startTs,
    endTs: row.endTs,
    durationSeconds: Math.max(0, row.endTs - row.startTs),
    messageCount: row.messageCount,
    initiator:
      row.initiatorId === null || row.initiatorName === null
        ? null
        : { memberId: row.initiatorId, name: row.initiatorName },
  }
}

function selectLongestSegment(rows: SegmentRow[]): JourneySegment | null {
  let longest: JourneySegment | null = null
  for (const row of rows) {
    const candidate = toJourneySegment(row)
    if (
      !longest ||
      candidate.durationSeconds > longest.durationSeconds ||
      (candidate.durationSeconds === longest.durationSeconds && candidate.messageCount > longest.messageCount) ||
      (candidate.durationSeconds === longest.durationSeconds &&
        candidate.messageCount === longest.messageCount &&
        candidate.startTs < longest.startTs)
    ) {
      longest = candidate
    }
  }
  return longest
}

function selectLongestSilence(rows: SegmentRow[]): JourneySilence | null {
  let longest: JourneySilence | null = null
  for (let index = 1; index < rows.length; index++) {
    const previous = rows[index - 1]
    const next = rows[index]
    const durationSeconds = next.startTs - previous.endTs
    if (durationSeconds < SILENCE_THRESHOLD_SECONDS) continue

    const candidate: JourneySilence = {
      previousSegmentId: previous.segmentId,
      nextSegmentId: next.segmentId,
      startTs: previous.endTs,
      endTs: next.startTs,
      durationSeconds,
      reopenedBy:
        next.initiatorId === null || next.initiatorName === null
          ? null
          : { memberId: next.initiatorId, name: next.initiatorName },
    }
    if (
      !longest ||
      candidate.durationSeconds > longest.durationSeconds ||
      (candidate.durationSeconds === longest.durationSeconds && candidate.endTs < longest.endTs)
    ) {
      longest = candidate
    }
  }
  return longest
}
