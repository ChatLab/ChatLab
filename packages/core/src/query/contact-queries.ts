import type { DatabaseAdapter } from '../interfaces'
import { accumulateCoOccurrencePairs } from './advanced/social'

export interface ContactMemberRef {
  id: number
  platformId: string
  name: string
  avatar: string | null
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

export function isValidContactPlatformId(platformId: string | null | undefined): platformId is string {
  return typeof platformId === 'string' && platformId.trim().length > 0
}

export function resolveOwnerMember(db: DatabaseAdapter): ContactMemberRef | null {
  const meta = db.prepare('SELECT owner_id FROM meta LIMIT 1').get() as { owner_id: string | null } | undefined
  if (!isValidContactPlatformId(meta?.owner_id)) return null

  const row = db
    .prepare(
      `SELECT
        id,
        platform_id as platformId,
        COALESCE(group_nickname, account_name, platform_id) as name,
        avatar
      FROM member
      WHERE platform_id = ? AND COALESCE(account_name, '') != '系统消息'
      LIMIT 1`
    )
    .get(meta.owner_id) as ContactMemberRef | undefined

  return row ?? null
}

export function getNonSystemMembersForContacts(db: DatabaseAdapter): ContactMemberRef[] {
  const rows = db
    .prepare(
      `SELECT
        id,
        platform_id as platformId,
        COALESCE(group_nickname, account_name, platform_id) as name,
        avatar
      FROM member
      WHERE COALESCE(account_name, '') != '系统消息'
      ORDER BY id ASC`
    )
    .all() as unknown as ContactMemberRef[]

  return rows.filter((row) => isValidContactPlatformId(row.platformId))
}

export function getPrivateContactFacts(db: DatabaseAdapter, ownerMemberId: number): PrivateContactFacts {
  const candidates = getNonSystemMembersForContacts(db).filter((member) => member.id !== ownerMemberId)
  if (candidates.length === 0) return { type: 'missing' }
  if (candidates.length > 1) return { type: 'ambiguous', candidates }

  const countRow = db
    .prepare(
      `SELECT COUNT(*) as count
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       WHERE COALESCE(m.account_name, '') != '系统消息'`
    )
    .get() as { count: number } | undefined

  const monthRows = db
    .prepare(
      `SELECT DISTINCT strftime('%Y-%m', msg.ts, 'unixepoch', 'localtime') as month
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       WHERE COALESCE(m.account_name, '') != '系统消息'
       ORDER BY month ASC`
    )
    .all() as Array<{ month: string }>

  const lastRow = db
    .prepare(
      `SELECT MAX(msg.ts) as lastMessageTs
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       WHERE COALESCE(m.account_name, '') != '系统消息'`
    )
    .get() as { lastMessageTs: number | null } | undefined

  return {
    type: 'ok',
    contact: candidates[0],
    privateMessageCount: countRow?.count ?? 0,
    activeMonths: monthRows.map((row) => row.month).filter(Boolean),
    lastMessageTs: lastRow?.lastMessageTs ?? null,
  }
}

export function getGroupContactFacts(db: DatabaseAdapter, ownerMemberId: number): GroupContactFacts[] {
  const contacts = getNonSystemMembersForContacts(db).filter((member) => member.id !== ownerMemberId)
  const messageRows = db
    .prepare(
      `SELECT msg.sender_id as senderId, COUNT(*) as messageCount
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       WHERE COALESCE(m.account_name, '') != '系统消息'
       GROUP BY msg.sender_id`
    )
    .all() as Array<{ senderId: number; messageCount: number }>

  const messageCounts = new Map(messageRows.map((row) => [row.senderId, row.messageCount]))
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]))
  const coOccurrenceRows = db
    .prepare(
      `SELECT msg.sender_id as senderId, msg.ts as ts
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       WHERE COALESCE(m.account_name, '') != '系统消息'
       ORDER BY msg.ts ASC, msg.id ASC`
    )
    .all() as Array<{ senderId: number; ts: number }>
  const coOccurrenceStats = new Map<number, { coOccurrenceCount: number; coOccurrenceRawScore: number }>()

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
         AND COALESCE(sender.account_name, '') != '系统消息'
         AND COALESCE(targetMember.account_name, '') != '系统消息'`
    )
    .all() as Array<{ replySenderId: number; replyTs: number; targetSenderId: number }>

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
      lastInteractionTs: stats.lastInteractionTs,
    }
  })
}
