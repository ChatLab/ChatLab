import { ChatType, MessageType, type AnnualSummaryRange, type ChatPlatform } from '@openchatlab/shared-types'
import type { DatabaseAdapter } from '../interfaces'
import { buildContactKey, shouldScopeContactToSession } from './contact-identity'
import { getNonSystemMembersForContacts, resolveOwnerMember, type ContactMemberRef } from './contact-queries'
import { getSessionMeta, isChatSessionDb } from './session-queries'

export type { AnnualSummaryRange } from '@openchatlab/shared-types'

export interface AnnualSummaryAnalyzedFacts {
  kind: 'analyzed'
  availableDataYears: number[]
  ownerMessagesByDay: Record<string, number>
  directContactKeysByDay: Record<string, string[]>
  messageTypeCounts: Record<string, number>
  textLengthCounts: Record<string, number>
}

export type AnnualSummarySessionFacts =
  | AnnualSummaryAnalyzedFacts
  | {
      kind:
        | 'not_chat_db'
        | 'missing_meta'
        | 'unsupported_type'
        | 'missing_owner'
        | 'unresolved_owner'
        | 'private_missing'
        | 'private_ambiguous'
        | 'failed'
      availableDataYears: number[]
    }

export interface AnnualSummaryAggregatedData {
  availableDataYears: number[]
  latestDataYear: number | null
  metrics: {
    sentMessageCount: number
    activeDayCount: number
    directContactCount: number
    averageMessagesPerDay: number
    averageDirectContactsPerDay: number
  }
  monthlyActivity: Array<{ month: string; messageCount: number }>
  dailyActivity: Array<{ date: string; messageCount: number }>
  messageTypes: Array<{ type: number; count: number }>
  textLength: {
    textMessageCount: number
    median: number | null
    p90: number | null
    buckets: Array<{ key: string; count: number }>
  }
  coverage: {
    totalSessions: number
    analyzedSessions: number
    missingOwnerSessions: number
    unresolvedOwnerSessions: number
    failedSessions: number
  }
}

const SYSTEM_MESSAGE_TYPES = [MessageType.SYSTEM, MessageType.RECALL]

export function getAnnualSummarySessionFacts(
  db: DatabaseAdapter,
  sessionId: string,
  range: AnnualSummaryRange
): AnnualSummarySessionFacts {
  if (!isChatSessionDb(db)) return emptyFacts('not_chat_db')
  const meta = getSessionMeta(db)
  if (!meta) return emptyFacts('missing_meta')
  if (meta.type !== ChatType.PRIVATE && meta.type !== ChatType.GROUP) return emptyFacts('unsupported_type')
  if (!meta.ownerId?.trim()) return emptyFacts('missing_owner')
  const owner = resolveOwnerMember(db)
  if (!owner) return emptyFacts('unresolved_owner')

  const contacts = getNonSystemMembersForContacts(db).filter((member) => member.id !== owner.id)
  let privateContact: ContactMemberRef | null = null
  if (meta.type === ChatType.PRIVATE) {
    const activeContacts = getActivePrivateContacts(db, contacts, owner.id, range)
    const candidates = activeContacts.length > 0 ? activeContacts : contacts
    if (candidates.length === 0) return emptyFacts('private_missing')
    if (candidates.length > 1) return emptyFacts('private_ambiguous')
    privateContact = candidates[0]
  }

  const ownerMessagesByDay = rowsToNumberRecord(
    db
      .prepare(
        `SELECT strftime('%Y-%m-%d', msg.ts, 'unixepoch', 'localtime') as key, COUNT(*) as count
         FROM message msg
         WHERE msg.sender_id = ? AND msg.ts >= ? AND msg.ts <= ?
           AND msg.type NOT IN (${SYSTEM_MESSAGE_TYPES.join(', ')})
         GROUP BY key ORDER BY key`
      )
      .all(owner.id, range.startTs, range.endTs) as Array<{ key: string; count: number }>
  )
  const messageTypeCounts = rowsToNumberRecord(
    db
      .prepare(
        `SELECT CAST(msg.type AS TEXT) as key, COUNT(*) as count
         FROM message msg
         WHERE msg.sender_id = ? AND msg.ts >= ? AND msg.ts <= ?
           AND msg.type NOT IN (${SYSTEM_MESSAGE_TYPES.join(', ')})
         GROUP BY msg.type ORDER BY msg.type`
      )
      .all(owner.id, range.startTs, range.endTs) as Array<{ key: string; count: number }>
  )
  const textLengthCounts = rowsToNumberRecord(
    db
      .prepare(
        `SELECT CAST(LENGTH(msg.content) AS TEXT) as key, COUNT(*) as count
         FROM message msg
         WHERE msg.sender_id = ? AND msg.ts >= ? AND msg.ts <= ?
           AND msg.type = ${MessageType.TEXT} AND msg.content IS NOT NULL AND LENGTH(msg.content) > 0
         GROUP BY LENGTH(msg.content) ORDER BY LENGTH(msg.content)`
      )
      .all(owner.id, range.startTs, range.endTs) as Array<{ key: string; count: number }>
  )
  const availableDataYears = (
    db
      .prepare(
        `SELECT DISTINCT CAST(strftime('%Y', msg.ts, 'unixepoch', 'localtime') AS INTEGER) as year
         FROM message msg
         WHERE msg.sender_id = ? AND msg.type NOT IN (${SYSTEM_MESSAGE_TYPES.join(', ')})
         ORDER BY year DESC`
      )
      .all(owner.id) as Array<{ year: number }>
  ).map((row) => row.year)

  return {
    kind: 'analyzed',
    availableDataYears,
    ownerMessagesByDay,
    directContactKeysByDay:
      meta.type === ChatType.PRIVATE && privateContact
        ? getPrivateDirectContactsByDay(db, sessionId, meta.platform, privateContact, range)
        : getGroupDirectContactsByDay(db, sessionId, meta.platform, owner.id, contacts, range),
    messageTypeCounts,
    textLengthCounts,
  }
}

export function aggregateAnnualSummaryFacts(
  facts: AnnualSummarySessionFacts[],
  range: AnnualSummaryRange,
  elapsedDayCount: number
): AnnualSummaryAggregatedData {
  const ownerMessagesByDay = new Map<string, number>()
  const directContactsByDay = new Map<string, Set<string>>()
  const directContacts = new Set<string>()
  const messageTypes = new Map<number, number>()
  const textLengths = new Map<number, number>()
  const availableDataYears = new Set<number>()
  const coverage = {
    totalSessions: 0,
    analyzedSessions: 0,
    missingOwnerSessions: 0,
    unresolvedOwnerSessions: 0,
    failedSessions: 0,
  }

  for (const item of facts) {
    if (item.kind === 'not_chat_db' || item.kind === 'missing_meta' || item.kind === 'unsupported_type') continue
    coverage.totalSessions++
    if (item.kind === 'missing_owner') {
      coverage.missingOwnerSessions++
      continue
    }
    if (item.kind === 'unresolved_owner') {
      coverage.unresolvedOwnerSessions++
      continue
    }
    if (item.kind !== 'analyzed') {
      coverage.failedSessions++
      continue
    }

    coverage.analyzedSessions++
    item.availableDataYears.forEach((year) => availableDataYears.add(year))
    mergeNumberRecord(ownerMessagesByDay, item.ownerMessagesByDay)
    mergeNumberRecord(messageTypes, item.messageTypeCounts, Number)
    mergeNumberRecord(textLengths, item.textLengthCounts, Number)
    for (const [date, keys] of Object.entries(item.directContactKeysByDay)) {
      const daily = directContactsByDay.get(date) ?? new Set<string>()
      keys.forEach((key) => {
        daily.add(key)
        directContacts.add(key)
      })
      directContactsByDay.set(date, daily)
    }
  }

  const dailyActivity = [...ownerMessagesByDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, messageCount]) => ({ date, messageCount }))
  const sentMessageCount = dailyActivity.reduce((sum, item) => sum + item.messageCount, 0)
  const dailyDirectContactTotal = [...directContactsByDay.values()].reduce((sum, keys) => sum + keys.size, 0)
  const years = [...availableDataYears].sort((a, b) => b - a)

  return {
    availableDataYears: years,
    latestDataYear: years[0] ?? null,
    metrics: {
      sentMessageCount,
      activeDayCount: dailyActivity.length,
      directContactCount: directContacts.size,
      averageMessagesPerDay: roundAverage(sentMessageCount, elapsedDayCount),
      averageDirectContactsPerDay: roundAverage(dailyDirectContactTotal, elapsedDayCount),
    },
    monthlyActivity: buildMonthlyActivity(range, ownerMessagesByDay),
    dailyActivity,
    messageTypes: [...messageTypes.entries()].sort(([a], [b]) => a - b).map(([type, count]) => ({ type, count })),
    textLength: buildTextLengthSummary(textLengths),
    coverage,
  }
}

function getActivePrivateContacts(
  db: DatabaseAdapter,
  contacts: ContactMemberRef[],
  ownerId: number,
  range: AnnualSummaryRange
): ContactMemberRef[] {
  if (contacts.length <= 1) return contacts
  const byId = new Map(contacts.map((contact) => [contact.id, contact]))
  const rows = db
    .prepare(
      `SELECT DISTINCT msg.sender_id as senderId FROM message msg
       WHERE msg.sender_id <> ? AND msg.ts >= ? AND msg.ts <= ?
         AND msg.type NOT IN (${SYSTEM_MESSAGE_TYPES.join(', ')})`
    )
    .all(ownerId, range.startTs, range.endTs) as Array<{ senderId: number }>
  return rows.map((row) => byId.get(row.senderId)).filter((contact): contact is ContactMemberRef => Boolean(contact))
}

function getPrivateDirectContactsByDay(
  db: DatabaseAdapter,
  sessionId: string,
  platform: ChatPlatform,
  contact: ContactMemberRef,
  range: AnnualSummaryRange
): Record<string, string[]> {
  const rows = db
    .prepare(
      `SELECT DISTINCT strftime('%Y-%m-%d', msg.ts, 'unixepoch', 'localtime') as date
       FROM message msg
       WHERE msg.ts >= ? AND msg.ts <= ? AND msg.type NOT IN (${SYSTEM_MESSAGE_TYPES.join(', ')})
       ORDER BY date`
    )
    .all(range.startTs, range.endTs) as Array<{ date: string }>
  const key = buildContactKey(
    platform,
    contact.platformId,
    shouldScopeContactToSession(platform, contact) ? sessionId : undefined
  )
  return Object.fromEntries(rows.map((row) => [row.date, [key]]))
}

function getGroupDirectContactsByDay(
  db: DatabaseAdapter,
  sessionId: string,
  platform: ChatPlatform,
  ownerId: number,
  contacts: ContactMemberRef[],
  range: AnnualSummaryRange
): Record<string, string[]> {
  const byId = new Map(contacts.map((contact) => [contact.id, contact]))
  const rows = db
    .prepare(
      `SELECT
         strftime('%Y-%m-%d', msg.ts, 'unixepoch', 'localtime') as date,
         msg.sender_id as replySenderId,
         target.sender_id as targetSenderId
       FROM message msg
       JOIN message target ON msg.reply_to_message_id = target.platform_message_id
       WHERE msg.ts >= ? AND msg.ts <= ? AND msg.reply_to_message_id IS NOT NULL
         AND msg.type NOT IN (${SYSTEM_MESSAGE_TYPES.join(', ')})`
    )
    .all(range.startTs, range.endTs) as Array<{ date: string; replySenderId: number; targetSenderId: number }>
  const byDay = new Map<string, Set<string>>()
  for (const row of rows) {
    const contactId =
      row.replySenderId === ownerId ? row.targetSenderId : row.targetSenderId === ownerId ? row.replySenderId : null
    if (contactId === null) continue
    const contact = byId.get(contactId)
    if (!contact) continue
    const key = buildContactKey(
      platform,
      contact.platformId,
      shouldScopeContactToSession(platform, contact) ? sessionId : undefined
    )
    const keys = byDay.get(row.date) ?? new Set<string>()
    keys.add(key)
    byDay.set(row.date, keys)
  }
  return Object.fromEntries([...byDay.entries()].map(([date, keys]) => [date, [...keys].sort()]))
}

function buildMonthlyActivity(
  range: AnnualSummaryRange,
  ownerMessagesByDay: Map<string, number>
): Array<{ month: string; messageCount: number }> {
  const counts = new Map<string, number>()
  for (const [date, count] of ownerMessagesByDay) {
    const month = date.slice(0, 7)
    counts.set(month, (counts.get(month) ?? 0) + count)
  }
  return listMonths(range).map((month) => ({ month, messageCount: counts.get(month) ?? 0 }))
}

function listMonths(range: AnnualSummaryRange): string[] {
  if (range.mode === 'year' && range.year) {
    return Array.from({ length: 12 }, (_, index) => `${range.year}-${String(index + 1).padStart(2, '0')}`)
  }
  const current = new Date(range.startTs * 1000)
  current.setDate(1)
  current.setHours(0, 0, 0, 0)
  const end = new Date(range.endTs * 1000)
  const result: string[] = []
  while (current <= end) {
    result.push(`${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`)
    current.setMonth(current.getMonth() + 1)
  }
  return result
}

function buildTextLengthSummary(lengths: Map<number, number>): AnnualSummaryAggregatedData['textLength'] {
  const textMessageCount = [...lengths.values()].reduce((sum, count) => sum + count, 0)
  return {
    textMessageCount,
    median: weightedPercentile(lengths, 0.5),
    p90: weightedPercentile(lengths, 0.9),
    buckets: [
      { key: '1-10', count: countLengthRange(lengths, 1, 10) },
      { key: '11-30', count: countLengthRange(lengths, 11, 30) },
      { key: '31-100', count: countLengthRange(lengths, 31, 100) },
      { key: '101-300', count: countLengthRange(lengths, 101, 300) },
      { key: '300+', count: countLengthRange(lengths, 301, Number.POSITIVE_INFINITY) },
    ],
  }
}

function weightedPercentile(lengths: Map<number, number>, percentile: number): number | null {
  const entries = [...lengths.entries()].sort(([a], [b]) => a - b)
  const total = entries.reduce((sum, [, count]) => sum + count, 0)
  if (total === 0) return null
  const target = Math.floor((total - 1) * percentile)
  let seen = 0
  for (const [length, count] of entries) {
    seen += count
    if (seen > target) return length
  }
  return entries.at(-1)?.[0] ?? null
}

function countLengthRange(lengths: Map<number, number>, min: number, max: number): number {
  let count = 0
  for (const [length, value] of lengths) {
    if (length >= min && length <= max) count += value
  }
  return count
}

function rowsToNumberRecord(rows: Array<{ key: string; count: number }>): Record<string, number> {
  return Object.fromEntries(rows.filter((row) => row.key).map((row) => [row.key, row.count]))
}

function mergeNumberRecord<K extends string | number>(
  target: Map<K, number>,
  source: Record<string, number>,
  mapKey: (key: string) => K = (key) => key as K
): void {
  for (const [key, value] of Object.entries(source)) {
    const mapped = mapKey(key)
    target.set(mapped, (target.get(mapped) ?? 0) + value)
  }
}

function roundAverage(total: number, days: number): number {
  if (days <= 0) return 0
  return Math.round((total / days) * 100) / 100
}

function emptyFacts(kind: Exclude<AnnualSummarySessionFacts['kind'], 'analyzed'>): AnnualSummarySessionFacts {
  return { kind, availableDataYears: [] }
}
