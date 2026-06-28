import type { DatabaseAdapter } from '../interfaces'
import { hasColumn } from './filters'
import { accumulateCoOccurrencePairs } from './advanced/social'

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
    .get(meta.owner_id) as ContactMemberRow | undefined

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

function createReplyTimeFilter(startTs: number | null | undefined): { sql: string; params: unknown[] } {
  return typeof startTs === 'number'
    ? { sql: ' AND msg.ts >= ? AND target.ts >= ?', params: [startTs, startTs] }
    : { sql: '', params: [] }
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
