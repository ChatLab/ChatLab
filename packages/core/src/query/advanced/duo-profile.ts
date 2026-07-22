/**
 * Private-chat duo profile analysis.
 *
 * Results are deterministic local aggregates. The query never returns message
 * content, message ids, active-date lists, or full conversation segments.
 */

import type { TimeFilter } from '@openchatlab/shared-types'
import type { DatabaseAdapter } from '../../interfaces'
import { getNonSystemMembersForContacts, resolveOwnerMember } from '../contact-queries'
import { buildSystemMessageFilter, buildTimeFilter, hasTable } from '../filters'
import { getSessionMeta, hasSessionIndex } from '../session-queries'

const TEXT_MESSAGE_TYPE = 0
const SHORT_TEXT_MAX_LENGTH = 5
const LONG_TEXT_MIN_LENGTH = 30

export type DuoProfileUnavailableReason =
  | 'owner_missing'
  | 'counterpart_missing'
  | 'ambiguous'
  | 'empty_range'
  | 'not_private'

export interface DuoProfileMember {
  memberId: number
  platformId: string
  name: string
  role: 'owner' | 'counterpart'
  messageCount: number
  messageShare: number
  activeDays: number
  initiatedSegments: number | null
  closedSegments: number | null
  avgResponseSeconds: number | null
  responseCount: number | null
  continuationRate: number | null
  textMessageCount: number
  avgTextLength: number | null
  shortTextRate: number
  longTextRate: number
  nonTextRate: number
  topNonTextType: { type: number; count: number } | null
  hourlyActivity: number[]
  peakHour: number | null
  nightRate: number
  weekendRate: number
}

export type DuoProfileStats =
  | {
      status: 'unavailable'
      reason: DuoProfileUnavailableReason
      candidateCount?: number
    }
  | {
      status: 'ready'
      range: { firstMessageTs: number; lastMessageTs: number }
      hasSessionIndex: boolean
      members: [DuoProfileMember, DuoProfileMember]
      common: {
        activeDayIntersection: number
        activeDayUnion: number
        activeDayOverlapRate: number
        hourlyOverlapRate: number
        commonActiveHours: number[]
      }
    }

interface MessageAggregateRow {
  memberId: number
  messageCount: number
  activeDays: number
  textMessageCount: number
  avgTextLength: number | null
  shortTextCount: number
  longTextCount: number
  nonTextCount: number
  nightCount: number
  weekendCount: number
  firstMessageTs: number
  lastMessageTs: number
}

interface HourlyRow {
  memberId: number
  hour: number
  messageCount: number
}

interface NonTextTypeRow {
  memberId: number
  type: number
  messageCount: number
}

interface InteractionRow {
  memberId: number
  initiatedSegments: number
  closedSegments: number
  responseSeconds: number
  responseCount: number
  continuationCount: number
  continuationBase: number
}

interface InteractionStats {
  initiatedSegments: number
  closedSegments: number
  avgResponseSeconds: number | null
  responseCount: number
  continuationRate: number
}

interface ActiveDayOverlapRow {
  activeDayIntersection: number
  activeDayUnion: number
}

export function getDuoProfileStats(db: DatabaseAdapter, filter?: TimeFilter): DuoProfileStats {
  const meta = getSessionMeta(db)
  if (meta?.type !== 'private') return unavailable('not_private')

  const owner = resolveOwnerMember(db)
  if (!owner) return unavailable('owner_missing')

  const counterparts = getNonSystemMembersForContacts(db).filter((member) => member.id !== owner.id)
  if (counterparts.length === 0) return unavailable('counterpart_missing')
  if (counterparts.length > 1) return { ...unavailable('ambiguous'), candidateCount: counterparts.length }
  const counterpart = counterparts[0]

  // A duo profile is always about the whole pair. Ignore an accidental memberId
  // from a reused TimeFilter and keep only the selected time window.
  const effectiveFilter = filter
    ? {
        startTs: filter.startTs,
        endTs: filter.endTs,
      }
    : undefined
  const participantIds: [number, number] = [owner.id, counterpart.id]
  const messageRows = queryMessageAggregates(db, participantIds, effectiveFilter)
  const totalMessages = messageRows.reduce((sum, row) => sum + row.messageCount, 0)
  if (totalMessages === 0) return unavailable('empty_range')

  const hourlyRows = queryHourlyActivity(db, participantIds, effectiveFilter)
  const hourlyByMember = new Map<number, number[]>(participantIds.map((id) => [id, Array<number>(24).fill(0)]))
  for (const row of hourlyRows) hourlyByMember.get(row.memberId)![row.hour] = row.messageCount

  const topNonTextByMember = selectTopNonTextTypes(queryNonTextTypes(db, participantIds, effectiveFilter))
  const indexAvailable = hasSessionIndex(db) && hasTable(db, 'message_context')
  const interactionByMember = indexAvailable
    ? queryInteractions(db, participantIds, effectiveFilter)
    : new Map<number, InteractionStats>()
  const aggregateByMember = new Map(messageRows.map((row) => [row.memberId, row]))

  const members: [DuoProfileMember, DuoProfileMember] = [
    buildMember(
      owner,
      'owner',
      aggregateByMember.get(owner.id),
      hourlyByMember.get(owner.id)!,
      topNonTextByMember.get(owner.id) ?? null,
      indexAvailable ? interactionByMember.get(owner.id) : undefined,
      totalMessages,
      indexAvailable
    ),
    buildMember(
      counterpart,
      'counterpart',
      aggregateByMember.get(counterpart.id),
      hourlyByMember.get(counterpart.id)!,
      topNonTextByMember.get(counterpart.id) ?? null,
      indexAvailable ? interactionByMember.get(counterpart.id) : undefined,
      totalMessages,
      indexAvailable
    ),
  ]

  const activeDays = queryActiveDayOverlap(db, participantIds, effectiveFilter)
  const firstMessageTs = Math.min(...messageRows.map((row) => row.firstMessageTs))
  const lastMessageTs = Math.max(...messageRows.map((row) => row.lastMessageTs))

  return {
    status: 'ready',
    range: { firstMessageTs, lastMessageTs },
    hasSessionIndex: indexAvailable,
    members,
    common: {
      activeDayIntersection: activeDays.activeDayIntersection,
      activeDayUnion: activeDays.activeDayUnion,
      activeDayOverlapRate: percentage(activeDays.activeDayIntersection, activeDays.activeDayUnion),
      hourlyOverlapRate: calculateHourlyOverlap(members[0].hourlyActivity, members[1].hourlyActivity),
      commonActiveHours: selectCommonActiveHours(members[0].hourlyActivity, members[1].hourlyActivity),
    },
  }
}

function unavailable(reason: DuoProfileUnavailableReason): Extract<DuoProfileStats, { status: 'unavailable' }> {
  return { status: 'unavailable', reason }
}

function queryMessageAggregates(
  db: DatabaseAdapter,
  participantIds: [number, number],
  filter?: TimeFilter
): MessageAggregateRow[] {
  const { clause, params } = buildTimeFilter(filter, 'msg')
  const whereClause = `${buildSystemMessageFilter(clause)} AND msg.sender_id IN (?, ?)`

  return db
    .prepare(
      `SELECT
         msg.sender_id AS memberId,
         COUNT(*) AS messageCount,
         COUNT(DISTINCT strftime('%Y-%m-%d', msg.ts, 'unixepoch', 'localtime')) AS activeDays,
         SUM(CASE WHEN msg.type = ${TEXT_MESSAGE_TYPE}
                       AND msg.content IS NOT NULL
                       AND LENGTH(msg.content) > 0 THEN 1 ELSE 0 END) AS textMessageCount,
         ROUND(AVG(CASE WHEN msg.type = ${TEXT_MESSAGE_TYPE}
                            AND msg.content IS NOT NULL
                            AND LENGTH(msg.content) > 0 THEN LENGTH(msg.content) END), 1) AS avgTextLength,
         SUM(CASE WHEN msg.type = ${TEXT_MESSAGE_TYPE}
                       AND msg.content IS NOT NULL
                       AND LENGTH(msg.content) BETWEEN 1 AND ${SHORT_TEXT_MAX_LENGTH} THEN 1 ELSE 0 END) AS shortTextCount,
         SUM(CASE WHEN msg.type = ${TEXT_MESSAGE_TYPE}
                       AND msg.content IS NOT NULL
                       AND LENGTH(msg.content) >= ${LONG_TEXT_MIN_LENGTH} THEN 1 ELSE 0 END) AS longTextCount,
         SUM(CASE WHEN msg.type != ${TEXT_MESSAGE_TYPE} THEN 1 ELSE 0 END) AS nonTextCount,
         SUM(CASE WHEN CAST(strftime('%H', msg.ts, 'unixepoch', 'localtime') AS INTEGER) BETWEEN 0 AND 4
                  THEN 1 ELSE 0 END) AS nightCount,
         SUM(CASE WHEN CAST(strftime('%w', msg.ts, 'unixepoch', 'localtime') AS INTEGER) IN (0, 6)
                  THEN 1 ELSE 0 END) AS weekendCount,
         MIN(msg.ts) AS firstMessageTs,
         MAX(msg.ts) AS lastMessageTs
       FROM message msg
       JOIN member m ON m.id = msg.sender_id
       ${whereClause}
       GROUP BY msg.sender_id`
    )
    .all(...params, ...participantIds) as unknown as MessageAggregateRow[]
}

function queryHourlyActivity(db: DatabaseAdapter, participantIds: [number, number], filter?: TimeFilter): HourlyRow[] {
  const { clause, params } = buildTimeFilter(filter, 'msg')
  const whereClause = `${buildSystemMessageFilter(clause)} AND msg.sender_id IN (?, ?)`

  return db
    .prepare(
      `SELECT
         msg.sender_id AS memberId,
         CAST(strftime('%H', msg.ts, 'unixepoch', 'localtime') AS INTEGER) AS hour,
         COUNT(*) AS messageCount
       FROM message msg
       JOIN member m ON m.id = msg.sender_id
       ${whereClause}
       GROUP BY msg.sender_id, hour
       ORDER BY msg.sender_id ASC, hour ASC`
    )
    .all(...params, ...participantIds) as unknown as HourlyRow[]
}

function queryNonTextTypes(
  db: DatabaseAdapter,
  participantIds: [number, number],
  filter?: TimeFilter
): NonTextTypeRow[] {
  const { clause, params } = buildTimeFilter(filter, 'msg')
  const whereClause = `${buildSystemMessageFilter(clause)}
    AND msg.sender_id IN (?, ?)
    AND msg.type != ${TEXT_MESSAGE_TYPE}`

  return db
    .prepare(
      `SELECT msg.sender_id AS memberId, msg.type AS type, COUNT(*) AS messageCount
       FROM message msg
       JOIN member m ON m.id = msg.sender_id
       ${whereClause}
       GROUP BY msg.sender_id, msg.type
       ORDER BY msg.sender_id ASC, messageCount DESC, msg.type ASC`
    )
    .all(...params, ...participantIds) as unknown as NonTextTypeRow[]
}

function selectTopNonTextTypes(rows: NonTextTypeRow[]): Map<number, { type: number; count: number }> {
  const result = new Map<number, { type: number; count: number }>()
  for (const row of rows) {
    if (!result.has(row.memberId)) result.set(row.memberId, { type: row.type, count: row.messageCount })
  }
  return result
}

function queryActiveDayOverlap(
  db: DatabaseAdapter,
  participantIds: [number, number],
  filter?: TimeFilter
): ActiveDayOverlapRow {
  const { clause, params } = buildTimeFilter(filter, 'msg')
  const whereClause = `${buildSystemMessageFilter(clause)} AND msg.sender_id IN (?, ?)`
  const row = db
    .prepare(
      `WITH active_days AS (
         SELECT
           strftime('%Y-%m-%d', msg.ts, 'unixepoch', 'localtime') AS activeDate,
           msg.sender_id AS memberId
         FROM message msg
         JOIN member m ON m.id = msg.sender_id
         ${whereClause}
         GROUP BY activeDate, msg.sender_id
       ), day_flags AS (
         SELECT
           activeDate,
           MAX(CASE WHEN memberId = ? THEN 1 ELSE 0 END) AS ownerActive,
           MAX(CASE WHEN memberId = ? THEN 1 ELSE 0 END) AS counterpartActive
         FROM active_days
         GROUP BY activeDate
       )
       SELECT
         COALESCE(SUM(CASE WHEN ownerActive = 1 AND counterpartActive = 1 THEN 1 ELSE 0 END), 0)
           AS activeDayIntersection,
         COUNT(*) AS activeDayUnion
       FROM day_flags`
    )
    .get(...params, ...participantIds, ...participantIds) as ActiveDayOverlapRow | undefined

  return {
    activeDayIntersection: row?.activeDayIntersection ?? 0,
    activeDayUnion: row?.activeDayUnion ?? 0,
  }
}

function queryInteractions(
  db: DatabaseAdapter,
  participantIds: [number, number],
  filter?: TimeFilter
): Map<number, InteractionStats> {
  const { clause, params } = buildTimeFilter(filter, 'msg')
  const whereClause = `${buildSystemMessageFilter(clause)} AND msg.sender_id IN (?, ?)`
  const rows = db
    .prepare(
      `WITH filtered_messages AS (
         SELECT
           mc.segment_id AS segmentId,
           msg.id AS messageId,
           msg.sender_id AS memberId,
           msg.ts AS ts,
           msg.type AS type,
           msg.content AS content,
           ROW_NUMBER() OVER (
             PARTITION BY mc.segment_id ORDER BY msg.ts ASC, msg.id ASC
           ) AS ascendingPosition,
           ROW_NUMBER() OVER (
             PARTITION BY mc.segment_id ORDER BY msg.ts DESC, msg.id DESC
           ) AS descendingPosition,
           LAG(msg.sender_id) OVER (
             PARTITION BY mc.segment_id ORDER BY msg.ts ASC, msg.id ASC
           ) AS previousMemberId,
           LAG(msg.ts) OVER (
             PARTITION BY mc.segment_id ORDER BY msg.ts ASC, msg.id ASC
           ) AS previousTs,
           LAG(msg.type) OVER (
             PARTITION BY mc.segment_id ORDER BY msg.ts ASC, msg.id ASC
           ) AS previousType,
           LAG(msg.content) OVER (
             PARTITION BY mc.segment_id ORDER BY msg.ts ASC, msg.id ASC
           ) AS previousContent
         FROM message_context mc
         JOIN segment s ON s.id = mc.segment_id
         JOIN message msg ON msg.id = mc.message_id
         JOIN member m ON m.id = msg.sender_id
         ${whereClause}
       )
       SELECT
         memberId,
         SUM(CASE WHEN ascendingPosition = 1 THEN 1 ELSE 0 END) AS initiatedSegments,
         SUM(CASE WHEN descendingPosition = 1 THEN 1 ELSE 0 END) AS closedSegments,
         COALESCE(SUM(CASE WHEN type = ${TEXT_MESSAGE_TYPE}
                                AND previousType = ${TEXT_MESSAGE_TYPE}
                                AND content IS NOT NULL
                                AND LENGTH(content) > 0
                                AND previousContent IS NOT NULL
                                AND LENGTH(previousContent) > 0
                                AND previousMemberId != memberId
                           THEN ts - previousTs ELSE 0 END), 0) AS responseSeconds,
         SUM(CASE WHEN type = ${TEXT_MESSAGE_TYPE}
                       AND previousType = ${TEXT_MESSAGE_TYPE}
                       AND content IS NOT NULL
                       AND LENGTH(content) > 0
                       AND previousContent IS NOT NULL
                       AND LENGTH(previousContent) > 0
                       AND previousMemberId != memberId THEN 1 ELSE 0 END) AS responseCount,
         SUM(CASE WHEN previousMemberId = memberId THEN 1 ELSE 0 END) AS continuationCount,
         SUM(CASE WHEN previousMemberId IS NOT NULL THEN 1 ELSE 0 END) AS continuationBase
       FROM filtered_messages
       GROUP BY memberId`
    )
    .all(...params, ...participantIds) as unknown as InteractionRow[]

  return new Map(
    rows.map((row) => [
      row.memberId,
      {
        initiatedSegments: row.initiatedSegments,
        closedSegments: row.closedSegments,
        avgResponseSeconds: row.responseCount > 0 ? Math.round(row.responseSeconds / row.responseCount) : null,
        responseCount: row.responseCount,
        continuationRate: percentage(row.continuationCount, row.continuationBase),
      },
    ])
  )
}

function buildMember(
  identity: { id: number; platformId: string; name: string },
  role: DuoProfileMember['role'],
  row: MessageAggregateRow | undefined,
  hourlyActivity: number[],
  topNonTextType: DuoProfileMember['topNonTextType'],
  interaction: InteractionStats | undefined,
  totalMessages: number,
  indexAvailable: boolean
): DuoProfileMember {
  const messageCount = row?.messageCount ?? 0
  const textMessageCount = row?.textMessageCount ?? 0
  return {
    memberId: identity.id,
    platformId: identity.platformId,
    name: identity.name,
    role,
    messageCount,
    messageShare: percentage(messageCount, totalMessages),
    activeDays: row?.activeDays ?? 0,
    initiatedSegments: indexAvailable ? (interaction?.initiatedSegments ?? 0) : null,
    closedSegments: indexAvailable ? (interaction?.closedSegments ?? 0) : null,
    avgResponseSeconds: indexAvailable ? (interaction?.avgResponseSeconds ?? null) : null,
    responseCount: indexAvailable ? (interaction?.responseCount ?? 0) : null,
    continuationRate: indexAvailable ? (interaction?.continuationRate ?? 0) : null,
    textMessageCount,
    avgTextLength: row?.avgTextLength ?? null,
    shortTextRate: percentage(row?.shortTextCount ?? 0, textMessageCount),
    longTextRate: percentage(row?.longTextCount ?? 0, textMessageCount),
    nonTextRate: percentage(row?.nonTextCount ?? 0, messageCount),
    topNonTextType,
    hourlyActivity,
    peakHour: selectPeakHour(hourlyActivity),
    nightRate: percentage(row?.nightCount ?? 0, messageCount),
    weekendRate: percentage(row?.weekendCount ?? 0, messageCount),
  }
}

function selectPeakHour(hours: number[]): number | null {
  let peakHour: number | null = null
  let peakCount = 0
  for (let hour = 0; hour < hours.length; hour++) {
    if (hours[hour] > peakCount) {
      peakHour = hour
      peakCount = hours[hour]
    }
  }
  return peakHour
}

function calculateHourlyOverlap(ownerHours: number[], counterpartHours: number[]): number {
  const ownerTotal = ownerHours.reduce((sum, value) => sum + value, 0)
  const counterpartTotal = counterpartHours.reduce((sum, value) => sum + value, 0)
  if (ownerTotal === 0 || counterpartTotal === 0) return 0

  let overlap = 0
  for (let hour = 0; hour < 24; hour++) {
    overlap += Math.min(ownerHours[hour] / ownerTotal, counterpartHours[hour] / counterpartTotal)
  }
  return round(overlap * 100, 2)
}

function selectCommonActiveHours(ownerHours: number[], counterpartHours: number[]): number[] {
  const ownerTotal = ownerHours.reduce((sum, value) => sum + value, 0)
  const counterpartTotal = counterpartHours.reduce((sum, value) => sum + value, 0)
  if (ownerTotal === 0 || counterpartTotal === 0) return []

  return ownerHours
    .map((value, hour) => ({
      hour,
      overlap: Math.min(value / ownerTotal, counterpartHours[hour] / counterpartTotal),
    }))
    .filter((item) => item.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || a.hour - b.hour)
    .slice(0, 3)
    .map((item) => item.hour)
    .sort((a, b) => a - b)
}

function percentage(value: number, total: number): number {
  return total > 0 ? round((value / total) * 100, 2) : 0
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}
