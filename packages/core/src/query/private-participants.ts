import type { DatabaseAdapter } from '../interfaces'
import { getMembers } from './message-queries'
import { getSessionMeta } from './session-queries'

export interface PrivateChatParticipant {
  memberId: number
  name: string
  platformId: string
  isOwner: boolean
  messageCount: number
}

export type PrivateChatParticipantsResult =
  | { ok: true; participants: [PrivateChatParticipant, PrivateChatParticipant] }
  | { ok: false; reason: 'not_private_chat' | 'fewer_than_two_speakers' }

/**
 * The two people of a private chat. Its member table can hold more rows than that — a WeChat export lists the
 * participants of forwarded chat records as members who never wrote here — so the participants are read from who
 * actually wrote: the owner when `meta.owner_id` names one of the senders, plus the other sender with the most
 * messages; otherwise the two senders with the most messages (ties go to the lower member id). Messages from any
 * further sender take part in no private-chat measurement. Participants are returned in member id order.
 */
export function resolvePrivateChatParticipants(db: DatabaseAdapter): PrivateChatParticipantsResult {
  const meta = getSessionMeta(db)
  if (meta?.type !== 'private') return { ok: false, reason: 'not_private_chat' }

  const ownerId = meta.ownerId?.trim() || null
  // getMembers already leaves the system member out.
  const speakers = getMembers(db)
    .filter((member) => member.messageCount > 0)
    .sort((left, right) => right.messageCount - left.messageCount || left.id - right.id)
  const owner = ownerId === null ? undefined : speakers.find((member) => member.platformId === ownerId)
  const other = owner && speakers.find((member) => member !== owner)
  const chosen = owner && other ? [owner, other] : speakers.slice(0, 2)
  if (chosen.length < 2) return { ok: false, reason: 'fewer_than_two_speakers' }

  const [first, second] = chosen
    .map(
      (member): PrivateChatParticipant => ({
        memberId: member.id,
        name: member.name,
        platformId: member.platformId,
        isOwner: member.platformId === ownerId,
        messageCount: member.messageCount,
      })
    )
    .sort((left, right) => left.memberId - right.memberId)
  return { ok: true, participants: [first, second] }
}
