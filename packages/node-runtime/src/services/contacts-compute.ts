import { ChatType } from '@openchatlab/shared-types'
import type { ChatPlatform, ContactItem, ContactsDiagnostics, ContactSourceSession } from '@openchatlab/shared-types'
import {
  MIN_PRIVATE_SESSIONS_FOR_CONTACTS,
  computeFriendScores,
  computeNonFriendScores,
  getGroupContactFacts,
  getPrivateContactFacts,
  getSessionMeta,
  isChatSessionDb,
  isLowSignalNonFriend,
  isNameMatchPlatform,
  resolveOwnerMember,
} from '@openchatlab/core'
import type { ContactMemberRef, SessionMeta } from '@openchatlab/core'
import { appLogger } from '../logging/app-logger'
import type { SessionRuntimeAdapter } from './adapters'

export const CONTACTS_ALGORITHM_VERSION = 'contacts-v1'

export interface ContactsWorkerStats {
  durationMs: number
  totalSessions: number
  processedSessions: number
  skippedFailedSessions: number
}

export interface ContactsSnapshot {
  contacts: ContactItem[]
  diagnostics: ContactsDiagnostics
  algorithmVersion: string
  signature: string
  computedAt: number
  workerStats: ContactsWorkerStats
}

export interface ContactsComputeProgress {
  processedSessions: number
  totalSessions: number
  currentSessionId?: string
}

export interface ComputeContactsSnapshotOptions {
  adapter: SessionRuntimeAdapter
  signature: string
  now?: () => number
  onProgress?: (progress: ContactsComputeProgress) => void
}

interface ContactAccumulator {
  key: string
  platform: ChatPlatform
  platformId: string
  sessionScoped: boolean
  sessionId?: string
  displayName: string
  aliases: Set<string>
  avatar: string | null
  isFriend: boolean
  privateMessageCount: number
  activePrivateMonths: Set<string>
  commonGroupSessionIds: Set<string>
  coOccurrenceCount: number
  coOccurrenceRawScore: number
  replyInteractionCount: number
  repliesFromOwnerToContact: number
  repliesFromContactToOwner: number
  sourceSessions: ContactSourceSession[]
  lastInteractionTs: number | null
}

interface BuildContactsResult {
  contacts: ContactItem[]
  diagnostics: ContactsDiagnostics
}

export function computeContactsSnapshot(options: ComputeContactsSnapshotOptions): ContactsSnapshot {
  const startedAt = options.now?.() ?? Date.now()
  const sessionIds = options.adapter.listSessionIds()
  const result = computeContacts({
    adapter: options.adapter,
    sessionIds,
    onProgress: options.onProgress,
  })
  const finishedAt = options.now?.() ?? Date.now()
  return {
    ...result,
    algorithmVersion: CONTACTS_ALGORITHM_VERSION,
    signature: options.signature,
    computedAt: finishedAt,
    workerStats: {
      durationMs: Math.max(0, finishedAt - startedAt),
      totalSessions: sessionIds.length,
      processedSessions: sessionIds.length,
      skippedFailedSessions: result.diagnostics.skippedFailedSessions,
    },
  }
}

function computeContacts(options: {
  adapter: SessionRuntimeAdapter
  sessionIds: string[]
  onProgress?: (progress: ContactsComputeProgress) => void
}): BuildContactsResult {
  const diagnostics = createEmptyDiagnostics()
  const accumulators = new Map<string, ContactAccumulator>()
  let processedSessions = 0

  for (const sessionId of options.sessionIds) {
    options.onProgress?.({ processedSessions, totalSessions: options.sessionIds.length, currentSessionId: sessionId })
    try {
      const db = options.adapter.openReadonly(sessionId)
      if (!db || !isChatSessionDb(db)) continue
      const meta = getSessionMeta(db)
      if (!meta) continue
      if (meta.type === ChatType.PRIVATE) diagnostics.privateSessionCount++
      if (meta.type !== ChatType.PRIVATE && meta.type !== ChatType.GROUP) continue

      if (!meta.ownerId?.trim()) {
        diagnostics.skippedMissingOwnerSessions++
        continue
      }

      const owner = resolveOwnerMember(db)
      if (!owner) {
        diagnostics.skippedUnresolvedOwnerSessions++
        continue
      }

      if (meta.type === ChatType.PRIVATE) {
        collectPrivateSession(accumulators, diagnostics, sessionId, meta, owner.id, db)
      } else {
        collectGroupSession(accumulators, sessionId, meta, owner.id, db)
      }
    } catch (error) {
      diagnostics.skippedFailedSessions++
      appLogger.error('contacts', `failed to process contact session: ${sessionId}`, error)
    } finally {
      processedSessions++
      options.onProgress?.({ processedSessions, totalSessions: options.sessionIds.length, currentSessionId: sessionId })
    }
  }

  diagnostics.contactsEnabled = diagnostics.privateSessionCount > MIN_PRIVATE_SESSIONS_FOR_CONTACTS
  const contacts = buildContactItems([...accumulators.values()], diagnostics)
  return { contacts, diagnostics }
}

function collectPrivateSession(
  accumulators: Map<string, ContactAccumulator>,
  diagnostics: ContactsDiagnostics,
  sessionId: string,
  meta: SessionMeta,
  ownerMemberId: number,
  db: Parameters<typeof getPrivateContactFacts>[0]
): void {
  const facts = getPrivateContactFacts(db, ownerMemberId)
  if (facts.type === 'missing') return
  if (facts.type === 'ambiguous') {
    diagnostics.skippedAmbiguousPrivateSessions++
    return
  }

  const acc = getOrCreateAccumulator(accumulators, sessionId, meta, facts.contact)
  acc.isFriend = true
  acc.privateMessageCount += facts.privateMessageCount
  for (const month of facts.activeMonths) acc.activePrivateMonths.add(month)
  updateLastInteraction(acc, facts.lastMessageTs)
  acc.sourceSessions.push({
    id: sessionId,
    name: meta.name,
    platform: meta.platform,
    type: ChatType.PRIVATE,
    messageCount: facts.privateMessageCount,
    privateMessageCount: facts.privateMessageCount,
    lastMessageTs: facts.lastMessageTs,
  })
}

function collectGroupSession(
  accumulators: Map<string, ContactAccumulator>,
  sessionId: string,
  meta: SessionMeta,
  ownerMemberId: number,
  db: Parameters<typeof getGroupContactFacts>[0]
): void {
  for (const facts of getGroupContactFacts(db, ownerMemberId)) {
    const acc = getOrCreateAccumulator(accumulators, sessionId, meta, facts.contact)
    acc.commonGroupSessionIds.add(sessionId)
    acc.coOccurrenceCount += facts.coOccurrenceCount
    acc.coOccurrenceRawScore += facts.coOccurrenceRawScore
    acc.replyInteractionCount += facts.replyInteractionCount
    acc.repliesFromOwnerToContact += facts.repliesFromOwnerToContact
    acc.repliesFromContactToOwner += facts.repliesFromContactToOwner
    updateLastInteraction(acc, facts.lastInteractionTs)
    acc.sourceSessions.push({
      id: sessionId,
      name: meta.name,
      platform: meta.platform,
      type: ChatType.GROUP,
      messageCount: facts.messageCount,
      coOccurrenceCount: facts.coOccurrenceCount,
      coOccurrenceRawScore: facts.coOccurrenceRawScore,
      replyInteractionCount: facts.replyInteractionCount,
      repliesFromOwnerToContact: facts.repliesFromOwnerToContact,
      repliesFromContactToOwner: facts.repliesFromContactToOwner,
      lastInteractionTs: facts.lastInteractionTs,
    })
  }
}

function buildContactItems(accumulators: ContactAccumulator[], diagnostics: ContactsDiagnostics): ContactItem[] {
  const friendInputs = accumulators
    .filter((acc) => acc.isFriend)
    .map((acc) => ({
      acc,
      privateMessageCount: acc.privateMessageCount,
      activeMonths: [...acc.activePrivateMonths],
      commonGroupCount: acc.commonGroupSessionIds.size,
    }))
  const nonFriendInputs = accumulators
    .filter((acc) => !acc.isFriend)
    .map((acc) => ({
      acc,
      coOccurrenceRawScore: acc.coOccurrenceRawScore,
      commonGroupCount: acc.commonGroupSessionIds.size,
      replyInteractionCount: acc.replyInteractionCount,
      coOccurrenceCount: acc.coOccurrenceCount,
    }))

  const friendScores = computeFriendScores(friendInputs)
  const nonFriendScores = computeNonFriendScores(nonFriendInputs)
  const contacts: ContactItem[] = []

  for (const input of friendInputs) {
    const score = friendScores.get(input) ?? { score: 0, scoreBreakdown: {} }
    contacts.push(toContactItem(input.acc, 'friend', false, score))
  }

  for (const input of nonFriendInputs) {
    const score = nonFriendScores.get(input) ?? { score: 0, scoreBreakdown: {} }
    const isLowSignal = isLowSignalNonFriend(input)
    const item = toContactItem(input.acc, 'non_friend', isLowSignal, score)
    if (item.isLowSignal) diagnostics.hiddenLowSignalNonFriends++
    contacts.push(item)
  }

  return contacts.sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName))
}

function toContactItem(
  acc: ContactAccumulator,
  pool: 'friend' | 'non_friend',
  isLowSignal: boolean,
  scoring: { score: number; scoreBreakdown: ContactItem['scoreBreakdown'] }
): ContactItem {
  const aliases = [...acc.aliases].filter((alias) => alias !== acc.displayName)
  const searchText = [acc.displayName, acc.platformId, ...aliases].join(' ').toLowerCase()

  return {
    key: acc.key,
    platform: acc.platform,
    platformId: acc.platformId,
    sessionScoped: acc.sessionScoped,
    sessionId: acc.sessionId,
    displayName: acc.displayName,
    aliases,
    avatar: acc.avatar,
    isFriend: acc.isFriend,
    pool,
    isLowSignal,
    score: scoring.score,
    scoreBreakdown: {
      ...scoring.scoreBreakdown,
      privateMessageCount: acc.privateMessageCount || scoring.scoreBreakdown.privateMessageCount,
      activePrivateMonths: acc.activePrivateMonths.size || scoring.scoreBreakdown.activePrivateMonths,
      commonGroupCount: acc.commonGroupSessionIds.size,
      coOccurrenceCount: acc.coOccurrenceCount,
      coOccurrenceRawScore: acc.coOccurrenceRawScore,
      replyInteractionCount: acc.replyInteractionCount,
      repliesFromOwnerToContact: acc.repliesFromOwnerToContact,
      repliesFromContactToOwner: acc.repliesFromContactToOwner,
    },
    sourceSessions: acc.sourceSessions,
    searchText,
    lastInteractionTs: acc.lastInteractionTs,
  }
}

export function createEmptyContactsDiagnostics(): ContactsDiagnostics {
  return createEmptyDiagnostics()
}

function createEmptyDiagnostics(): ContactsDiagnostics {
  return {
    privateSessionCount: 0,
    contactsEnabled: false,
    skippedMissingOwnerSessions: 0,
    skippedUnresolvedOwnerSessions: 0,
    skippedAmbiguousPrivateSessions: 0,
    skippedInvalidPlatformIdMembers: 0,
    skippedFailedSessions: 0,
    hiddenLowSignalNonFriends: 0,
    warnings: [],
  }
}

function getOrCreateAccumulator(
  accumulators: Map<string, ContactAccumulator>,
  sessionId: string,
  meta: SessionMeta,
  contact: ContactMemberRef
): ContactAccumulator {
  const sessionScoped = isNameMatchPlatform(meta.platform)
  const key = buildContactKey(meta.platform, contact.platformId, sessionScoped ? sessionId : undefined)
  const existing = accumulators.get(key)
  if (existing) {
    mergeContactIdentity(existing, contact)
    return existing
  }

  const created: ContactAccumulator = {
    key,
    platform: meta.platform,
    platformId: contact.platformId,
    sessionScoped,
    sessionId: sessionScoped ? sessionId : undefined,
    displayName: contact.name || contact.platformId,
    aliases: new Set([contact.platformId, contact.name].filter(Boolean)),
    avatar: contact.avatar,
    isFriend: false,
    privateMessageCount: 0,
    activePrivateMonths: new Set(),
    commonGroupSessionIds: new Set(),
    coOccurrenceCount: 0,
    coOccurrenceRawScore: 0,
    replyInteractionCount: 0,
    repliesFromOwnerToContact: 0,
    repliesFromContactToOwner: 0,
    sourceSessions: [],
    lastInteractionTs: null,
  }
  accumulators.set(key, created)
  return created
}

function buildContactKey(platform: ChatPlatform, platformId: string, sessionId?: string): string {
  const normalizedPlatform = platform.trim()
  const normalizedPlatformId = platformId.trim()
  if (!normalizedPlatform) throw new Error('platform is required')
  if (!normalizedPlatformId) throw new Error('platformId is required')
  return sessionId?.trim()
    ? `${normalizedPlatform}:${sessionId.trim()}:${normalizedPlatformId}`
    : `${normalizedPlatform}:${normalizedPlatformId}`
}

function mergeContactIdentity(acc: ContactAccumulator, contact: ContactMemberRef): void {
  if (contact.name) acc.aliases.add(contact.name)
  acc.aliases.add(contact.platformId)
  if ((!acc.displayName || acc.displayName === acc.platformId) && contact.name) {
    acc.displayName = contact.name
  }
  if (!acc.avatar && contact.avatar) acc.avatar = contact.avatar
}

function updateLastInteraction(acc: ContactAccumulator, ts: number | null): void {
  if (ts === null) return
  acc.lastInteractionTs = Math.max(acc.lastInteractionTs ?? 0, ts)
}
