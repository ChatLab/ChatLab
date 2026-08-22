import type { DatabaseAdapter } from '../interfaces'
import { hasColumn } from './filters'
import { accumulateCoOccurrencePairs, accumulateSelectedCoOccurrencePairs } from './advanced/social'

const SYSTEM_MESSAGE_TYPES = [80, 81] as const
const SYSTEM_MESSAGE_TYPES_SQL = SYSTEM_MESSAGE_TYPES.join(', ')
const LEGACY_SYSTEM_ACCOUNT_NAME = '系统消息'

export interface ContactMemberRef {
  id: number
  platformId: string
  name: string
  aliases: string[]
  avatar: string | null
}

export interface ContactFactsOptions {
  startTs?: number | null
}

export interface ParticipantSessionFactsOptions {
  startTs?: number | null
  endTs?: number | null
}

export interface ParticipantSessionFacts {
  memberId: number
  ownMessageCount: number
  sessionMessageCount: number
  firstOwnMessageTs: number | null
  lastOwnMessageTs: number | null
  activeDays: number
  memberCount: number
  sessionFirstMessageTs: number | null
  sessionLastMessageTs: number | null
}

export interface ParticipantSetInteractionFactsOptions extends ParticipantSessionFactsOptions {
  maxAnchorsPerPair?: number
  maxProximityMessages?: number
}

export interface ParticipantInteractionAnchor {
  messageId: number
  relatedMessageId?: number
  timestamp: number
  signal: 'direct_reply' | 'proximity'
  fromMemberId: number
  toMemberId: number
}

export interface ParticipantInteractionMemberFacts {
  memberId: number
  messageCount: number
  firstMessageTs: number | null
  lastMessageTs: number | null
  activeDays: number
}

export interface ParticipantInteractionPairFacts {
  sourceMemberId: number
  targetMemberId: number
  directReplyCount: number
  repliesFromSourceToTarget: number
  repliesFromTargetToSource: number
  lastDirectReplyTs: number | null
  coOccurrenceCount: number | null
  coOccurrenceRawScore: number | null
  lastProximityTs: number | null
  coActiveDays: number
  anchors: ParticipantInteractionAnchor[]
  anchorsTruncated: boolean
}

export interface ParticipantSetInteractionFacts {
  participants: ParticipantInteractionMemberFacts[]
  overlapRange: { startTs: number; endTs: number } | null
  allParticipantsCoActiveDays: number
  pairs: ParticipantInteractionPairFacts[]
  proximityStatus: 'complete' | 'partial' | 'skipped_budget'
  memberCount: number
  sessionFirstMessageTs: number | null
  sessionLastMessageTs: number | null
}

export type PrivateContactFacts =
  | {
      type: 'ok'
      contact: ContactMemberRef
      privateMessageCount: number
      activeMonths: string[]
      lastMessageTs: number | null
    }
  | { type: 'missing' }
  | { type: 'ambiguous'; candidates: ContactMemberRef[] }

export interface GroupContactFacts {
  contact: ContactMemberRef
  messageCount: number
  coOccurrenceCount: number
  coOccurrenceRawScore: number
  replyInteractionCount: number
  repliesFromOwnerToContact: number
  repliesFromContactToOwner: number
  lastInteractionTs: number | null
}

export interface RelationshipGraphMemberFact {
  contact: ContactMemberRef
  messageCount: number
  lastMessageTs: number | null
}

export interface RelationshipGraphEdgeFact {
  source: ContactMemberRef
  target: ContactMemberRef
  coOccurrenceCount: number
  coOccurrenceRawScore: number
  replyInteractionCount: number
  repliesFromSourceToTarget: number
  repliesFromTargetToSource: number
  lastInteractionTs: number | null
}

export interface GroupRelationshipGraphFacts {
  members: RelationshipGraphMemberFact[]
  edges: RelationshipGraphEdgeFact[]
  ownerMessageCount: number
}

export function isValidContactPlatformId(platformId: string | null | undefined): platformId is string {
  return typeof platformId === 'string' && platformId.trim().length > 0
}

export function resolveOwnerMember(db: DatabaseAdapter): ContactMemberRef | null {
  const meta = db.prepare('SELECT owner_id FROM meta LIMIT 1').get() as { owner_id: string | null } | undefined
  if (!isValidContactPlatformId(meta?.owner_id)) return null

  return resolveContactMember(db, meta.owner_id)
}

export function resolveContactMember(db: DatabaseAdapter, platformId: string): ContactMemberRef | null {
  if (!isValidContactPlatformId(platformId)) return null
  const aliasesSelect = hasColumn(db, 'member', 'aliases') ? 'aliases' : 'NULL as aliases'

  const row = db
    .prepare(
      `SELECT
        id,
        platform_id as platformId,
        COALESCE(group_nickname, account_name, platform_id) as name,
        ${aliasesSelect},
        avatar
      FROM member m
      WHERE platform_id = ? AND ${nonSystemContactMemberCondition(db, 'm')}
      LIMIT 1`
    )
    .get(platformId) as ContactMemberRow | undefined

  return row ? mapContactMemberRow(row) : null
}

export function getNonSystemMembersForContacts(db: DatabaseAdapter): ContactMemberRef[] {
  const aliasesSelect = hasColumn(db, 'member', 'aliases') ? 'aliases' : 'NULL as aliases'
  const rows = db
    .prepare(
      `SELECT
        id,
        platform_id as platformId,
        COALESCE(group_nickname, account_name, platform_id) as name,
        ${aliasesSelect},
        avatar
      FROM member m
      WHERE ${nonSystemContactMemberCondition(db, 'm')}
      ORDER BY id ASC`
    )
    .all() as unknown as ContactMemberRow[]

  return rows.map(mapContactMemberRow).filter((row) => isValidContactPlatformId(row.platformId))
}

export function getLatestContactMessageTs(db: DatabaseAdapter): number | null {
  const row = db
    .prepare(
      `SELECT MAX(msg.ts) as ts
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       WHERE ${nonSystemMessageCondition(db, 'msg', 'm')}`
    )
    .get() as { ts: number | null } | undefined

  return row?.ts ?? null
}

/**
 * Return exact activity facts for one member without assuming that the member is
 * the owner or the private-chat counterpart.
 */
export function getParticipantSessionFacts(
  db: DatabaseAdapter,
  memberId: number,
  options: ParticipantSessionFactsOptions = {}
): ParticipantSessionFacts {
  const timeFilter = createBoundedMessageTimeFilter('msg', options)
  const row = db
    .prepare(
      `SELECT
        COUNT(*) as sessionMessageCount,
        COALESCE(SUM(CASE WHEN msg.sender_id = ? THEN 1 ELSE 0 END), 0) as ownMessageCount,
        MIN(CASE WHEN msg.sender_id = ? THEN msg.ts END) as firstOwnMessageTs,
        MAX(CASE WHEN msg.sender_id = ? THEN msg.ts END) as lastOwnMessageTs,
        COUNT(DISTINCT CASE
          WHEN msg.sender_id = ? THEN strftime('%Y-%m-%d', msg.ts, 'unixepoch', 'localtime')
        END) as activeDays
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       WHERE ${nonSystemMessageCondition(db, 'msg', 'm')}${timeFilter.sql}`
    )
    .get(memberId, memberId, memberId, memberId, ...timeFilter.params) as
    | {
        sessionMessageCount: number
        ownMessageCount: number
        firstOwnMessageTs: number | null
        lastOwnMessageTs: number | null
        activeDays: number
      }
    | undefined
  const dataRange = db
    .prepare(
      `SELECT MIN(msg.ts) as firstMessageTs, MAX(msg.ts) as lastMessageTs
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       WHERE ${nonSystemMessageCondition(db, 'msg', 'm')}`
    )
    .get() as { firstMessageTs: number | null; lastMessageTs: number | null } | undefined

  return {
    memberId,
    ownMessageCount: row?.ownMessageCount ?? 0,
    sessionMessageCount: row?.sessionMessageCount ?? 0,
    firstOwnMessageTs: row?.firstOwnMessageTs ?? null,
    lastOwnMessageTs: row?.lastOwnMessageTs ?? null,
    activeDays: row?.activeDays ?? 0,
    memberCount: getNonSystemMembersForContacts(db).length,
    sessionFirstMessageTs: dataRange?.firstMessageTs ?? null,
    sessionLastMessageTs: dataRange?.lastMessageTs ?? null,
  }
}

export function getParticipantSetInteractionFacts(
  db: DatabaseAdapter,
  rawMemberIds: number[],
  options: ParticipantSetInteractionFactsOptions = {}
): ParticipantSetInteractionFacts {
  const memberIds = [...new Set(rawMemberIds)]
  if (memberIds.length < 2) throw new Error('At least two distinct member IDs are required')
  const placeholders = memberIds.map(() => '?').join(', ')
  const timeFilter = createBoundedMessageTimeFilter('msg', options)
  const activityRows = db
    .prepare(
      `SELECT
        msg.sender_id as memberId,
        COUNT(*) as messageCount,
        MIN(msg.ts) as firstMessageTs,
        MAX(msg.ts) as lastMessageTs,
        COUNT(DISTINCT strftime('%Y-%m-%d', msg.ts, 'unixepoch', 'localtime')) as activeDays
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       WHERE ${nonSystemMessageCondition(db, 'msg', 'm')}
         AND msg.sender_id IN (${placeholders})${timeFilter.sql}
       GROUP BY msg.sender_id`
    )
    .all(...memberIds, ...timeFilter.params) as Array<{
    memberId: number
    messageCount: number
    firstMessageTs: number | null
    lastMessageTs: number | null
    activeDays: number
  }>
  const activityByMemberId = new Map(activityRows.map((row) => [row.memberId, row]))
  const participants = memberIds.map((memberId): ParticipantInteractionMemberFacts => {
    const row = activityByMemberId.get(memberId)
    return {
      memberId,
      messageCount: row?.messageCount ?? 0,
      firstMessageTs: row?.firstMessageTs ?? null,
      lastMessageTs: row?.lastMessageTs ?? null,
      activeDays: row?.activeDays ?? 0,
    }
  })

  const activeDayRows = db
    .prepare(
      `SELECT
        msg.sender_id as memberId,
        strftime('%Y-%m-%d', msg.ts, 'unixepoch', 'localtime') as activeDay
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       WHERE ${nonSystemMessageCondition(db, 'msg', 'm')}
         AND msg.sender_id IN (${placeholders})${timeFilter.sql}
       GROUP BY msg.sender_id, activeDay`
    )
    .all(...memberIds, ...timeFilter.params) as Array<{ memberId: number; activeDay: string }>
  const activeDaysByMemberId = new Map(memberIds.map((memberId) => [memberId, new Set<string>()]))
  for (const row of activeDayRows) activeDaysByMemberId.get(row.memberId)?.add(row.activeDay)

  const pairMap = new Map<string, ParticipantInteractionPairFacts>()
  for (let sourceIndex = 0; sourceIndex < memberIds.length - 1; sourceIndex++) {
    for (let targetIndex = sourceIndex + 1; targetIndex < memberIds.length; targetIndex++) {
      const sourceMemberId = memberIds[sourceIndex]
      const targetMemberId = memberIds[targetIndex]
      pairMap.set(contactPairKey(sourceMemberId, targetMemberId), {
        sourceMemberId,
        targetMemberId,
        directReplyCount: 0,
        repliesFromSourceToTarget: 0,
        repliesFromTargetToSource: 0,
        lastDirectReplyTs: null,
        coOccurrenceCount: 0,
        coOccurrenceRawScore: 0,
        lastProximityTs: null,
        coActiveDays: countSetIntersection(
          activeDaysByMemberId.get(sourceMemberId) ?? new Set(),
          activeDaysByMemberId.get(targetMemberId) ?? new Set()
        ),
        anchors: [],
        anchorsTruncated: false,
      })
    }
  }

  const replyRows = db
    .prepare(
      `SELECT
        msg.id as messageId,
        target.id as relatedMessageId,
        msg.sender_id as replySenderId,
        target.sender_id as targetSenderId,
        msg.ts as replyTs
       FROM message msg
       JOIN message target ON msg.reply_to_message_id = target.platform_message_id
       JOIN member sender ON msg.sender_id = sender.id
       JOIN member targetMember ON target.sender_id = targetMember.id
       WHERE msg.reply_to_message_id IS NOT NULL
         AND ${nonSystemMessageCondition(db, 'msg', 'sender')}
         AND ${nonSystemMessageCondition(db, 'target', 'targetMember')}
         AND msg.sender_id IN (${placeholders})
         AND target.sender_id IN (${placeholders})${timeFilter.sql}
       ORDER BY msg.ts DESC, msg.id DESC`
    )
    .all(...memberIds, ...memberIds, ...timeFilter.params) as Array<{
    messageId: number
    relatedMessageId: number
    replySenderId: number
    targetSenderId: number
    replyTs: number
  }>
  const maxAnchorsPerPair = Math.max(0, Math.floor(options.maxAnchorsPerPair ?? 4))
  const replyDirectionsSeen = new Set<string>()
  for (const row of replyRows) {
    if (row.replySenderId === row.targetSenderId) continue
    const pair = pairMap.get(contactPairKey(row.replySenderId, row.targetSenderId))
    if (!pair) continue
    pair.directReplyCount++
    if (row.replySenderId === pair.sourceMemberId) pair.repliesFromSourceToTarget++
    else pair.repliesFromTargetToSource++
    pair.lastDirectReplyTs = Math.max(pair.lastDirectReplyTs ?? 0, row.replyTs)
    const directionKey = `${row.replySenderId}:${row.targetSenderId}`
    if (!replyDirectionsSeen.has(directionKey)) {
      replyDirectionsSeen.add(directionKey)
      if (pair.anchors.length < maxAnchorsPerPair) {
        pair.anchors.push({
          messageId: row.messageId,
          relatedMessageId: row.relatedMessageId,
          timestamp: row.replyTs,
          signal: 'direct_reply',
          fromMemberId: row.replySenderId,
          toMemberId: row.targetSenderId,
        })
      } else {
        pair.anchorsTruncated = true
      }
    }
  }

  const maxProximityMessages = Math.max(0, Math.floor(options.maxProximityMessages ?? 200_000))
  let proximityStatus: ParticipantSetInteractionFacts['proximityStatus'] = 'complete'
  if (maxProximityMessages === 0) {
    proximityStatus = 'skipped_budget'
    for (const pair of pairMap.values()) {
      pair.coOccurrenceCount = null
      pair.coOccurrenceRawScore = null
    }
  } else {
    const proximityRows = db
      .prepare(
        `SELECT msg.id as messageId, msg.sender_id as senderId, msg.ts as ts
         FROM message msg
         JOIN member m ON msg.sender_id = m.id
         WHERE ${nonSystemMessageCondition(db, 'msg', 'm')}${timeFilter.sql}
         ORDER BY msg.ts ASC, msg.id ASC
         LIMIT ?`
      )
      .all(...timeFilter.params, maxProximityMessages + 1) as Array<{
      messageId: number
      senderId: number
      ts: number
    }>
    if (proximityRows.length > maxProximityMessages) {
      proximityRows.length = maxProximityMessages
      proximityStatus = 'partial'
    }
    const selectedPairFacts = accumulateSelectedCoOccurrencePairs(
      proximityRows,
      [...pairMap.values()].map((pair) => [pair.sourceMemberId, pair.targetMemberId] as const),
      // 多保留一个候选，用于区分“命中上限”和“确实省略了证据”。
      { maxAnchorsPerPair: maxAnchorsPerPair + 1 }
    )
    for (const selected of selectedPairFacts) {
      const pair = pairMap.get(contactPairKey(selected.sourceId, selected.targetId))
      if (!pair) continue
      pair.coOccurrenceCount = selected.coOccurrenceCount
      pair.coOccurrenceRawScore = selected.rawScore
      pair.lastProximityTs = selected.lastOccurrenceTs
      for (const anchor of selected.anchors) {
        if (pair.anchors.length >= maxAnchorsPerPair) {
          pair.anchorsTruncated = true
          break
        }
        pair.anchors.push({
          messageId: anchor.messageId,
          relatedMessageId: anchor.relatedMessageId,
          timestamp: anchor.timestamp,
          signal: 'proximity',
          fromMemberId: anchor.fromMemberId,
          toMemberId: anchor.toMemberId,
        })
      }
    }
    if (proximityStatus === 'partial') {
      for (const pair of pairMap.values()) {
        if (pair.coOccurrenceCount === 0) {
          pair.coOccurrenceCount = null
          pair.coOccurrenceRawScore = null
          pair.lastProximityTs = null
        }
      }
    }
  }

  const activeDaySets = memberIds.map((memberId) => activeDaysByMemberId.get(memberId) ?? new Set<string>())
  const firstMessageTimestamps = participants.map((participant) => participant.firstMessageTs)
  const lastMessageTimestamps = participants.map((participant) => participant.lastMessageTs)
  const dataRange = db
    .prepare(
      `SELECT MIN(msg.ts) as firstMessageTs, MAX(msg.ts) as lastMessageTs
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       WHERE ${nonSystemMessageCondition(db, 'msg', 'm')}`
    )
    .get() as { firstMessageTs: number | null; lastMessageTs: number | null } | undefined

  return {
    participants,
    overlapRange: calculateOverlapRange(firstMessageTimestamps, lastMessageTimestamps),
    allParticipantsCoActiveDays: countMultipleSetIntersection(activeDaySets),
    pairs: [...pairMap.values()],
    proximityStatus,
    memberCount: getNonSystemMembersForContacts(db).length,
    sessionFirstMessageTs: dataRange?.firstMessageTs ?? null,
    sessionLastMessageTs: dataRange?.lastMessageTs ?? null,
  }
}

export function getPrivateContactFacts(
  db: DatabaseAdapter,
  ownerMemberId: number,
  options: ContactFactsOptions = {}
): PrivateContactFacts {
  const candidates = getNonSystemMembersForContacts(db).filter((member) => member.id !== ownerMemberId)
  if (candidates.length === 0) return { type: 'missing' }

  const timeFilter = createMessageTimeFilter('msg', options.startTs)
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const activeCandidateRows = db
    .prepare(
      `SELECT msg.sender_id as senderId
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       WHERE ${nonSystemMessageCondition(db, 'msg', 'm')}
         AND msg.sender_id <> ?${timeFilter.sql}
       GROUP BY msg.sender_id`
    )
    .all(ownerMemberId, ...timeFilter.params) as Array<{ senderId: number }>
  const activeCandidates = activeCandidateRows
    .map((row) => candidateById.get(row.senderId))
    .filter((candidate): candidate is ContactMemberRef => Boolean(candidate))
  const resolvedCandidates = activeCandidates.length > 0 ? activeCandidates : candidates
  if (resolvedCandidates.length > 1) return { type: 'ambiguous', candidates: resolvedCandidates }

  const countRow = db
    .prepare(
      `SELECT COUNT(*) as count
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       WHERE ${nonSystemMessageCondition(db, 'msg', 'm')}${timeFilter.sql}`
    )
    .get(...timeFilter.params) as { count: number } | undefined

  const monthRows = db
    .prepare(
      `SELECT DISTINCT strftime('%Y-%m', msg.ts, 'unixepoch', 'localtime') as month
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       WHERE ${nonSystemMessageCondition(db, 'msg', 'm')}${timeFilter.sql}
       ORDER BY month ASC`
    )
    .all(...timeFilter.params) as Array<{ month: string }>

  const lastRow = db
    .prepare(
      `SELECT MAX(msg.ts) as lastMessageTs
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       WHERE ${nonSystemMessageCondition(db, 'msg', 'm')}${timeFilter.sql}`
    )
    .get(...timeFilter.params) as { lastMessageTs: number | null } | undefined

  return {
    type: 'ok',
    contact: resolvedCandidates[0],
    privateMessageCount: countRow?.count ?? 0,
    activeMonths: monthRows.map((row) => row.month).filter(Boolean),
    lastMessageTs: lastRow?.lastMessageTs ?? null,
  }
}

export function getGroupContactFacts(
  db: DatabaseAdapter,
  ownerMemberId: number,
  options: ContactFactsOptions = {}
): GroupContactFacts[] {
  const contacts = getNonSystemMembersForContacts(db).filter((member) => member.id !== ownerMemberId)
  const messageTimeFilter = createMessageTimeFilter('msg', options.startTs)
  const messageRows = db
    .prepare(
      `SELECT msg.sender_id as senderId, COUNT(*) as messageCount
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       WHERE ${nonSystemMessageCondition(db, 'msg', 'm')}${messageTimeFilter.sql}
       GROUP BY msg.sender_id`
    )
    .all(...messageTimeFilter.params) as Array<{ senderId: number; messageCount: number }>

  const messageCounts = new Map(messageRows.map((row) => [row.senderId, row.messageCount]))
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]))
  const coOccurrenceRows = db
    .prepare(
      `SELECT msg.sender_id as senderId, msg.ts as ts
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       WHERE ${nonSystemMessageCondition(db, 'msg', 'm')}${messageTimeFilter.sql}
       ORDER BY msg.ts ASC, msg.id ASC`
    )
    .all(...messageTimeFilter.params) as Array<{ senderId: number; ts: number }>
  const coOccurrenceStats = new Map<
    number,
    { coOccurrenceCount: number; coOccurrenceRawScore: number; lastOccurrenceTs: number }
  >()

  // 共现算法会产出任意成员对；联系人页只消费 owner 与候选联系人的关系边。
  for (const pair of accumulateCoOccurrencePairs(coOccurrenceRows)) {
    const contactId =
      pair.sourceId === ownerMemberId && contactById.has(pair.targetId)
        ? pair.targetId
        : pair.targetId === ownerMemberId && contactById.has(pair.sourceId)
          ? pair.sourceId
          : null
    if (contactId === null) continue
    coOccurrenceStats.set(contactId, {
      coOccurrenceCount: pair.coOccurrenceCount,
      coOccurrenceRawScore: pair.rawScore,
      lastOccurrenceTs: pair.lastOccurrenceTs,
    })
  }
  const replyStats = new Map<
    number,
    {
      repliesFromOwnerToContact: number
      repliesFromContactToOwner: number
      lastInteractionTs: number | null
    }
  >()

  const replyTimeFilter = createReplyTimeFilter(options.startTs)
  const replyRows = db
    .prepare(
      `SELECT
        msg.sender_id as replySenderId,
        msg.ts as replyTs,
        target.sender_id as targetSenderId
       FROM message msg
       JOIN message target ON msg.reply_to_message_id = target.platform_message_id
       JOIN member sender ON msg.sender_id = sender.id
       JOIN member targetMember ON target.sender_id = targetMember.id
       WHERE msg.reply_to_message_id IS NOT NULL
         AND ${nonSystemMessageCondition(db, 'msg', 'sender')}
         AND ${nonSystemMessageCondition(db, 'target', 'targetMember')}${replyTimeFilter.sql}`
    )
    .all(...replyTimeFilter.params) as Array<{ replySenderId: number; replyTs: number; targetSenderId: number }>

  const ensureReplyStats = (contactId: number) => {
    const existing = replyStats.get(contactId)
    if (existing) return existing
    const created = { repliesFromOwnerToContact: 0, repliesFromContactToOwner: 0, lastInteractionTs: null }
    replyStats.set(contactId, created)
    return created
  }

  for (const row of replyRows) {
    if (row.replySenderId === ownerMemberId && contactById.has(row.targetSenderId)) {
      const stats = ensureReplyStats(row.targetSenderId)
      stats.repliesFromOwnerToContact++
      stats.lastInteractionTs = Math.max(stats.lastInteractionTs ?? 0, row.replyTs)
    } else if (row.targetSenderId === ownerMemberId && contactById.has(row.replySenderId)) {
      const stats = ensureReplyStats(row.replySenderId)
      stats.repliesFromContactToOwner++
      stats.lastInteractionTs = Math.max(stats.lastInteractionTs ?? 0, row.replyTs)
    }
  }

  return contacts.map((contact) => {
    const stats = replyStats.get(contact.id) ?? {
      repliesFromOwnerToContact: 0,
      repliesFromContactToOwner: 0,
      lastInteractionTs: null,
    }
    const coOccurrence = coOccurrenceStats.get(contact.id)
    const replyInteractionCount = stats.repliesFromOwnerToContact + stats.repliesFromContactToOwner
    return {
      contact,
      messageCount: messageCounts.get(contact.id) ?? 0,
      coOccurrenceCount: coOccurrence?.coOccurrenceCount ?? 0,
      coOccurrenceRawScore: coOccurrence?.coOccurrenceRawScore ?? 0,
      replyInteractionCount,
      repliesFromOwnerToContact: stats.repliesFromOwnerToContact,
      repliesFromContactToOwner: stats.repliesFromContactToOwner,
      lastInteractionTs: stats.lastInteractionTs ?? coOccurrence?.lastOccurrenceTs ?? null,
    }
  })
}

export function getGroupRelationshipGraphFacts(
  db: DatabaseAdapter,
  ownerMemberId: number,
  options: ContactFactsOptions = {}
): GroupRelationshipGraphFacts {
  const contacts = getNonSystemMembersForContacts(db).filter((member) => member.id !== ownerMemberId)
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]))
  const messageTimeFilter = createMessageTimeFilter('msg', options.startTs)
  const messageRows = db
    .prepare(
      `SELECT msg.sender_id as senderId, COUNT(*) as messageCount, MAX(msg.ts) as lastMessageTs
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       WHERE ${nonSystemMessageCondition(db, 'msg', 'm')}${messageTimeFilter.sql}
       GROUP BY msg.sender_id`
    )
    .all(...messageTimeFilter.params) as Array<{ senderId: number; messageCount: number; lastMessageTs: number | null }>

  const memberStats = new Map<number, { messageCount: number; lastMessageTs: number | null }>()
  let ownerMessageCount = 0
  for (const row of messageRows) {
    if (row.senderId === ownerMemberId) {
      ownerMessageCount = row.messageCount
      continue
    }
    if (!contactById.has(row.senderId)) continue
    memberStats.set(row.senderId, {
      messageCount: row.messageCount,
      lastMessageTs: row.lastMessageTs ?? null,
    })
  }

  const coOccurrenceRows = db
    .prepare(
      `SELECT msg.sender_id as senderId, msg.ts as ts
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       WHERE ${nonSystemMessageCondition(db, 'msg', 'm')}${messageTimeFilter.sql}
       ORDER BY msg.ts ASC, msg.id ASC`
    )
    .all(...messageTimeFilter.params) as Array<{ senderId: number; ts: number }>

  const edgeStats = new Map<
    string,
    {
      sourceId: number
      targetId: number
      coOccurrenceCount: number
      coOccurrenceRawScore: number
      repliesFromSourceToTarget: number
      repliesFromTargetToSource: number
      lastInteractionTs: number | null
    }
  >()

  const ensureEdge = (aId: number, bId: number) => {
    const sourceId = Math.min(aId, bId)
    const targetId = Math.max(aId, bId)
    const key = `${sourceId}:${targetId}`
    const existing = edgeStats.get(key)
    if (existing) return existing
    const created = {
      sourceId,
      targetId,
      coOccurrenceCount: 0,
      coOccurrenceRawScore: 0,
      repliesFromSourceToTarget: 0,
      repliesFromTargetToSource: 0,
      lastInteractionTs: null,
    }
    edgeStats.set(key, created)
    return created
  }

  for (const pair of accumulateCoOccurrencePairs(coOccurrenceRows)) {
    if (!contactById.has(pair.sourceId) || !contactById.has(pair.targetId)) continue
    const edge = ensureEdge(pair.sourceId, pair.targetId)
    edge.coOccurrenceCount += pair.coOccurrenceCount
    edge.coOccurrenceRawScore += pair.rawScore
    edge.lastInteractionTs = Math.max(edge.lastInteractionTs ?? 0, pair.lastOccurrenceTs)
  }

  const replyTimeFilter = createReplyTimeFilter(options.startTs)
  const replyRows = db
    .prepare(
      `SELECT
        msg.sender_id as replySenderId,
        msg.ts as replyTs,
        target.sender_id as targetSenderId
       FROM message msg
       JOIN message target ON msg.reply_to_message_id = target.platform_message_id
       JOIN member sender ON msg.sender_id = sender.id
       JOIN member targetMember ON target.sender_id = targetMember.id
       WHERE msg.reply_to_message_id IS NOT NULL
         AND ${nonSystemMessageCondition(db, 'msg', 'sender')}
         AND ${nonSystemMessageCondition(db, 'target', 'targetMember')}${replyTimeFilter.sql}`
    )
    .all(...replyTimeFilter.params) as Array<{ replySenderId: number; replyTs: number; targetSenderId: number }>

  for (const row of replyRows) {
    if (!contactById.has(row.replySenderId) || !contactById.has(row.targetSenderId)) continue
    if (row.replySenderId === row.targetSenderId) continue
    const edge = ensureEdge(row.replySenderId, row.targetSenderId)
    if (row.replySenderId === edge.sourceId) edge.repliesFromSourceToTarget++
    else edge.repliesFromTargetToSource++
    edge.lastInteractionTs = Math.max(edge.lastInteractionTs ?? 0, row.replyTs)
  }

  const members = contacts.map((contact) => {
    const stats = memberStats.get(contact.id)
    return {
      contact,
      messageCount: stats?.messageCount ?? 0,
      lastMessageTs: stats?.lastMessageTs ?? null,
    }
  })

  const edges: RelationshipGraphEdgeFact[] = []
  for (const edge of edgeStats.values()) {
    const source = contactById.get(edge.sourceId)
    const target = contactById.get(edge.targetId)
    if (!source || !target) continue
    const replyInteractionCount = edge.repliesFromSourceToTarget + edge.repliesFromTargetToSource
    if (edge.coOccurrenceCount <= 0 && replyInteractionCount <= 0) continue
    edges.push({
      source,
      target,
      coOccurrenceCount: edge.coOccurrenceCount,
      coOccurrenceRawScore: edge.coOccurrenceRawScore,
      replyInteractionCount,
      repliesFromSourceToTarget: edge.repliesFromSourceToTarget,
      repliesFromTargetToSource: edge.repliesFromTargetToSource,
      lastInteractionTs: edge.lastInteractionTs,
    })
  }

  return { members, edges, ownerMessageCount }
}

function createMessageTimeFilter(
  alias: string,
  startTs: number | null | undefined
): { sql: string; params: unknown[] } {
  return typeof startTs === 'number' ? { sql: ` AND ${alias}.ts >= ?`, params: [startTs] } : { sql: '', params: [] }
}

function createBoundedMessageTimeFilter(
  alias: string,
  options: ParticipantSessionFactsOptions
): { sql: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []
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

function createReplyTimeFilter(startTs: number | null | undefined): { sql: string; params: unknown[] } {
  return typeof startTs === 'number'
    ? { sql: ' AND msg.ts >= ? AND target.ts >= ?', params: [startTs, startTs] }
    : { sql: '', params: [] }
}

function contactPairKey(left: number, right: number): string {
  return left < right ? `${left}:${right}` : `${right}:${left}`
}

function countSetIntersection(left: Set<string>, right: Set<string>): number {
  const smaller = left.size <= right.size ? left : right
  const larger = smaller === left ? right : left
  let count = 0
  for (const value of smaller) {
    if (larger.has(value)) count++
  }
  return count
}

function countMultipleSetIntersection(sets: Set<string>[]): number {
  if (sets.length === 0) return 0
  return sets.slice(1).reduce((intersection, current) => {
    for (const value of intersection) {
      if (!current.has(value)) intersection.delete(value)
    }
    return intersection
  }, new Set(sets[0])).size
}

function calculateOverlapRange(
  firstTimestamps: Array<number | null>,
  lastTimestamps: Array<number | null>
): { startTs: number; endTs: number } | null {
  if (firstTimestamps.some((value) => value === null) || lastTimestamps.some((value) => value === null)) return null
  const startTs = Math.max(...(firstTimestamps as number[]))
  const endTs = Math.min(...(lastTimestamps as number[]))
  return startTs <= endTs ? { startTs, endTs } : null
}

interface ContactMemberRow {
  id: number
  platformId: string
  name: string
  aliases: string | null
  avatar: string | null
}

function mapContactMemberRow(row: ContactMemberRow): ContactMemberRef {
  return {
    id: row.id,
    platformId: row.platformId,
    name: row.name,
    aliases: parseContactAliases(row.aliases),
    avatar: row.avatar ?? null,
  }
}

function parseContactAliases(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((alias): alias is string => typeof alias === 'string' && alias.length > 0)
      : []
  } catch {
    return []
  }
}
function nonSystemContactMemberCondition(db: DatabaseAdapter, memberAlias: string): string {
  // 系统消息名称会随平台和导出语言变化；联系人候选优先用稳定 sender identity 和消息类型识别伪成员。
  return `(${nonSystemMemberIdentityCondition(db, memberAlias)}
    AND (
      NOT EXISTS (
        SELECT 1 FROM message system_msg
        WHERE system_msg.sender_id = ${memberAlias}.id
          AND system_msg.type IN (${SYSTEM_MESSAGE_TYPES_SQL})
      )
      OR EXISTS (
        SELECT 1 FROM message non_system_msg
        WHERE non_system_msg.sender_id = ${memberAlias}.id
          AND non_system_msg.type NOT IN (${SYSTEM_MESSAGE_TYPES_SQL})
      )
    ))`
}

function nonSystemMessageCondition(db: DatabaseAdapter, messageAlias: string, memberAlias: string): string {
  return `(${messageAlias}.type NOT IN (${SYSTEM_MESSAGE_TYPES_SQL})
    AND ${nonSystemMemberIdentityCondition(db, memberAlias)})`
}

function nonSystemMemberIdentityCondition(db: DatabaseAdapter, memberAlias: string): string {
  return `(LOWER(COALESCE(${memberAlias}.platform_id, '')) != 'system'
    AND COALESCE(${memberAlias}.account_name, '') != '${LEGACY_SYSTEM_ACCOUNT_NAME}'
    AND ${notGroupSelfMemberCondition(db, memberAlias)})`
}

function notGroupSelfMemberCondition(db: DatabaseAdapter, memberAlias: string): string {
  const clauses = [
    `(TRIM(COALESCE(session_meta.name, '')) != ''
      AND LOWER(TRIM(COALESCE(${memberAlias}.platform_id, ''))) = LOWER(TRIM(session_meta.name))
      AND LOWER(TRIM(COALESCE(${memberAlias}.account_name, ''))) = LOWER(TRIM(session_meta.name)))`,
  ]

  if (hasColumn(db, 'meta', 'group_id')) {
    clauses.unshift(
      `(TRIM(COALESCE(session_meta.group_id, '')) != ''
        AND LOWER(TRIM(COALESCE(${memberAlias}.platform_id, ''))) = LOWER(TRIM(session_meta.group_id)))`
    )
  }

  return `NOT EXISTS (
    SELECT 1 FROM meta session_meta
    WHERE LOWER(COALESCE(session_meta.type, '')) = 'group'
      AND (${clauses.join(' OR ')})
  )`
}
