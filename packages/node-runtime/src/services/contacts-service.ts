import { ChatType } from '@openchatlab/shared-types'
import type {
  ChatPlatform,
  ContactItem,
  ContactOverridePatch,
  ContactsCacheState,
  ContactsDiagnostics,
  ContactsResponse,
  ContactSourceSession,
  ContactTier,
} from '@openchatlab/shared-types'
import {
  MIN_PRIVATE_SESSIONS_FOR_CONTACTS,
  applyContactOverride,
  assignFriendTiers,
  assignNonFriendTiers,
  computeFriendScores,
  computeNonFriendScores,
  getGroupContactFacts,
  getPrivateContactFacts,
  getSessionMeta,
  isChatSessionDb,
  isNameMatchPlatform,
  resolveOwnerMember,
} from '@openchatlab/core'
import type { ContactMemberRef, SessionMeta } from '@openchatlab/core'
import { getDbFileVersion } from '../cache/analytics-cache'
import { appLogger } from '../logging/app-logger'
import type { SessionRuntimeAdapter } from './adapters'
import { ContactsOverridesManager, buildContactOverrideKey } from './contacts-overrides'

export const CONTACTS_ALGORITHM_VERSION = 'contacts-v1'

export interface ContactsServiceOptions {
  forceRecompute?: boolean
  acceptStale?: boolean
}

export interface ContactsServiceDeps {
  adapter: SessionRuntimeAdapter
  systemDir: string
  now?: () => number
}

export interface ContactsService {
  getContacts(options?: ContactsServiceOptions): ContactsResponse
  setContactOverride(key: string, patch: ContactOverridePatch): void
  deleteContactOverride(key: string): void
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
  private readonly overrides: ContactsOverridesManager
  private cache: CachedContacts | null = null

  constructor(private readonly deps: ContactsServiceDeps) {
    this.overrides = new ContactsOverridesManager(deps.systemDir)
  }

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

  setContactOverride(key: string, patch: ContactOverridePatch): void {
    this.overrides.saveOverride(key, patch)
    this.invalidateContactsCache()
    appLogger.info('contacts', 'contact override saved', { key })
  }

  deleteContactOverride(key: string): void {
    this.overrides.deleteOverride(key)
    this.invalidateContactsCache()
    appLogger.info('contacts', 'contact override deleted', { key })
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
    const overrides = this.overrides.load()
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
    const friendTierInputs = friendInputs.map((input) => ({
      input,
      score: friendScores.get(input)?.score ?? 0,
      privateMessageCount: input.privateMessageCount,
    }))
    const friendTiers = assignFriendTiers(friendTierInputs)

    const nonFriendScores = computeNonFriendScores(nonFriendInputs)
    const nonFriendTierInputs = nonFriendInputs.map((input) => ({
      input,
      score: nonFriendScores.get(input)?.score ?? 0,
      coOccurrenceCount: input.coOccurrenceCount,
      replyInteractionCount: input.replyInteractionCount,
    }))
    const nonFriendTiers = assignNonFriendTiers(nonFriendTierInputs)

    const contacts: ContactItem[] = []

    // 评分和分层按好友/非好友分池计算；最终再应用手动锁定，保证用户选择拥有最高优先级。
    for (const tierInput of friendTierInputs) {
      const { input } = tierInput
      const score = friendScores.get(input) ?? { score: 0, scoreBreakdown: {} }
      const algorithmTier = friendTiers.tiers.get(tierInput) ?? 'acquaintance'
      contacts.push(this.toContactItem(input.acc, 'friend', algorithmTier, score, overrides[input.acc.key]))
    }

    for (const tierInput of nonFriendTierInputs) {
      const { input } = tierInput
      const score = nonFriendScores.get(input) ?? { score: 0, scoreBreakdown: {} }
      const algorithmTier = nonFriendTiers.tiers.get(tierInput) ?? 'low_interaction'
      const item = this.toContactItem(input.acc, 'non_friend', algorithmTier, score, overrides[input.acc.key])
      if (item.tier === 'low_interaction') diagnostics.hiddenLowInteractionNonFriends++
      contacts.push(item)
    }

    return contacts.sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName))
  }

  private toContactItem(
    acc: ContactAccumulator,
    pool: 'friend' | 'non_friend',
    algorithmTier: ContactTier,
    scoring: { score: number; scoreBreakdown: ContactItem['scoreBreakdown'] },
    override: Parameters<typeof applyContactOverride>[1]
  ): ContactItem {
    const applied = applyContactOverride(algorithmTier, override)
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
      tier: applied.tier,
      algorithmTier: applied.algorithmTier,
      lockedTier: applied.lockedTier,
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
    const parts = [`algorithm:${CONTACTS_ALGORITHM_VERSION}`, `overrides:${this.overrides.getSignaturePart()}`]
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
    hiddenLowInteractionNonFriends: 0,
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
  const key = buildContactOverrideKey({
    platform: meta.platform,
    platformId: contact.platformId,
    sessionId,
    matchMode: sessionScoped ? 'name' : 'platform_id',
  })
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
