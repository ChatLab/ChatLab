import { ChatType } from '@openchatlab/shared-types'
import type {
  ChatPlatform,
  ContactItem,
  ContactsCacheState,
  ContactsDiagnostics,
  ContactsResponse,
  ContactSourceSession,
} from '@openchatlab/shared-types'
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
import { getDbFileVersion } from '../cache/analytics-cache'
import { appLogger } from '../logging/app-logger'
import type { SessionRuntimeAdapter } from './adapters'

export const CONTACTS_ALGORITHM_VERSION = 'contacts-v1'

export interface ContactsServiceOptions {
  forceRecompute?: boolean
  acceptStale?: boolean
}

export interface ContactsServiceDeps {
  adapter: SessionRuntimeAdapter
  now?: () => number
}

export interface ContactsService {
  getContacts(options?: ContactsServiceOptions): ContactsResponse
  invalidateContactsCache(): void
}

interface CachedContacts {
  contacts: ContactItem[]
  diagnostics: ContactsDiagnostics
  algorithmVersion: string
  signature: string
  computedAt: number
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

export function createContactsService(deps: ContactsServiceDeps): ContactsService {
  return new DefaultContactsService(deps)
}

class DefaultContactsService implements ContactsService {
  private cache: CachedContacts | null = null

  constructor(private readonly deps: ContactsServiceDeps) {}

  getContacts(options: ContactsServiceOptions = {}): ContactsResponse {
    const signature = this.buildSignature()
    if (!options.forceRecompute && this.cache) {
      if (this.cache.signature === signature) return this.toResponse(this.cache, 'fresh')
      if (options.acceptStale) return this.toResponse(this.cache, 'stale', 'signature_changed')
    }

    const computedAt = this.now()
    const result = this.computeContacts()
    this.cache = {
      ...result,
      algorithmVersion: CONTACTS_ALGORITHM_VERSION,
      signature,
      computedAt,
    }
    appLogger.info('contacts', 'contacts recomputed', {
      contactCount: result.contacts.length,
      privateSessionCount: result.diagnostics.privateSessionCount,
      skippedFailedSessions: result.diagnostics.skippedFailedSessions,
    })
    return this.toResponse(this.cache, 'fresh')
  }

  invalidateContactsCache(): void {
    this.cache = null
  }

  private computeContacts(): BuildContactsResult {
    const diagnostics = createEmptyDiagnostics()
    const accumulators = new Map<string, ContactAccumulator>()

    for (const sessionId of this.deps.adapter.listSessionIds()) {
      try {
        const db = this.deps.adapter.openReadonly(sessionId)
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
          this.collectPrivateSession(accumulators, diagnostics, sessionId, meta, owner.id, db)
        } else {
          this.collectGroupSession(accumulators, sessionId, meta, owner.id, db)
        }
      } catch (error) {
        diagnostics.skippedFailedSessions++
        appLogger.error('contacts', `failed to process contact session: ${sessionId}`, error)
      }
    }

    diagnostics.contactsEnabled = diagnostics.privateSessionCount > MIN_PRIVATE_SESSIONS_FOR_CONTACTS
    const contacts = this.buildContactItems([...accumulators.values()], diagnostics)
    return { contacts, diagnostics }
  }

  private collectPrivateSession(
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

  private collectGroupSession(
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

  private buildContactItems(accumulators: ContactAccumulator[], diagnostics: ContactsDiagnostics): ContactItem[] {
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

    // 评分仍按好友/群聊联系人分池计算；分池后的 score 只用于排序，不再生成关系定性标签。
    for (const input of friendInputs) {
      const score = friendScores.get(input) ?? { score: 0, scoreBreakdown: {} }
      contacts.push(this.toContactItem(input.acc, 'friend', false, score))
    }

    for (const input of nonFriendInputs) {
      const score = nonFriendScores.get(input) ?? { score: 0, scoreBreakdown: {} }
      const isLowSignal = isLowSignalNonFriend(input)
      const item = this.toContactItem(input.acc, 'non_friend', isLowSignal, score)
      if (item.isLowSignal) diagnostics.hiddenLowSignalNonFriends++
      contacts.push(item)
    }

    return contacts.sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName))
  }

  private toContactItem(
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

  private buildSignature(): string {
    const parts = [`algorithm:${CONTACTS_ALGORITHM_VERSION}`]
    for (const sessionId of [...this.deps.adapter.listSessionIds()].sort()) {
      const dbPath = this.deps.adapter.getDbPath(sessionId)
      parts.push(`${sessionId}:${getDbFileVersion(dbPath)}`)
    }
    return parts.join('|')
  }

  private toResponse(
    cached: CachedContacts,
    status: ContactsCacheState['status'],
    staleReason?: string
  ): ContactsResponse {
    return {
      contacts: cached.contacts,
      diagnostics: cached.diagnostics,
      algorithmVersion: cached.algorithmVersion,
      cache: {
        status,
        computedAt: cached.computedAt,
        signature: cached.signature,
        staleReason,
      },
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }
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
