import { ChatType } from '@openchatlab/shared-types'
import type {
  ChatPlatform,
  ContactItem,
  ContactsDiagnostics,
  ContactsTimeRangePreset,
  ContactsTimeRangeState,
  ContactSourceSession,
} from '@openchatlab/shared-types'
import {
  MIN_PRIVATE_SESSIONS_FOR_CONTACTS,
  computeFriendScores,
  computeNonFriendScores,
  getGroupContactFacts,
  getLatestContactMessageTs,
  getPrivateContactFacts,
  getSessionMeta,
  isChatSessionDb,
  isNameMatchPlatform,
  resolveOwnerMember,
} from '@openchatlab/core'
import type { ContactMemberRef, SessionMeta } from '@openchatlab/core'
import { getDbFileVersion } from '../../cache/analytics-cache'
import { appLogger } from '../../logging/app-logger'
import type { SessionRuntimeAdapter } from '../adapters'
import {
  buildContactsSessionFactsCacheKey,
  buildContactsSessionLatestCacheKey,
  createEmptyContactsFactsCacheStats,
  readCachedContactsSessionFacts,
  readCachedContactsSessionLatest,
  writeCachedContactsSessionFacts,
  writeCachedContactsSessionLatest,
  type ContactsCachedGroupFacts,
  type ContactsCachedPrivateFacts,
  type ContactsFactsCacheStats,
  type ContactsSessionFacts,
  type ContactsSessionLatestFacts,
  type ContactsSessionMetaFacts,
} from './facts-cache'
import { resolveContactsTimeRange } from './time-range'

export const CONTACTS_ALGORITHM_VERSION = 'contacts-v2'

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
  timeRange: ContactsTimeRangeState
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
  timeRangePreset?: ContactsTimeRangePreset
  factsCacheDir?: string
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

interface ContactsFactsCacheContext {
  dir: string
  latestKey: string
  stats: ContactsFactsCacheStats
}

export function computeContactsSnapshot(options: ComputeContactsSnapshotOptions): ContactsSnapshot {
  const startedAt = options.now?.() ?? Date.now()
  const sessionIds = options.adapter.listSessionIds()
  const factsCache = options.factsCacheDir ? createFactsCacheContext(options.factsCacheDir) : null
  const timeRange = resolveContactsTimeRange(
    options.timeRangePreset,
    findGlobalLatestMessageTs(options.adapter, sessionIds, factsCache)
  )
  const result = computeContacts({
    adapter: options.adapter,
    sessionIds,
    timeRange,
    factsCache,
    onProgress: options.onProgress,
  })
  const finishedAt = options.now?.() ?? Date.now()
  if (factsCache) {
    appLogger.info('contacts', 'contacts session facts cache summary', factsCache.stats)
  }
  return {
    ...result,
    algorithmVersion: CONTACTS_ALGORITHM_VERSION,
    signature: options.signature,
    timeRange,
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
  timeRange: ContactsTimeRangeState
  factsCache: ContactsFactsCacheContext | null
  onProgress?: (progress: ContactsComputeProgress) => void
}): BuildContactsResult {
  const diagnostics = createEmptyDiagnostics()
  const accumulators = new Map<string, ContactAccumulator>()
  let processedSessions = 0

  for (const sessionId of options.sessionIds) {
    options.onProgress?.({ processedSessions, totalSessions: options.sessionIds.length, currentSessionId: sessionId })
    try {
      const facts = getSessionFacts(options.adapter, sessionId, options.timeRange, options.factsCache)
      applySessionFacts(accumulators, diagnostics, sessionId, facts)
    } catch (error) {
      diagnostics.skippedFailedSessions++
      appLogger.error('contacts', `failed to process contact session: ${sessionId}`, error)
    } finally {
      processedSessions++
      options.onProgress?.({ processedSessions, totalSessions: options.sessionIds.length, currentSessionId: sessionId })
    }
  }

  diagnostics.contactsEnabled = diagnostics.activePrivateSessionCount > MIN_PRIVATE_SESSIONS_FOR_CONTACTS
  const contacts = buildContactItems([...accumulators.values()])
  return { contacts, diagnostics }
}

function findGlobalLatestMessageTs(
  adapter: SessionRuntimeAdapter,
  sessionIds: string[],
  factsCache: ContactsFactsCacheContext | null
): number | null {
  let latest: number | null = null
  for (const sessionId of sessionIds) {
    const dbVersion = getSessionDbVersion(adapter, sessionId)
    const cached = readLatestFacts(sessionId, factsCache, dbVersion)
    if (cached) {
      if (cached.latestMessageTs !== null) latest = Math.max(latest ?? 0, cached.latestMessageTs)
      continue
    }
    try {
      const db = adapter.openReadonly(sessionId)
      const ts = db && isChatSessionDb(db) ? getLatestContactMessageTs(db) : null
      writeLatestFacts(adapter, sessionId, factsCache, { latestMessageTs: ts }, dbVersion)
      if (ts !== null) latest = Math.max(latest ?? 0, ts)
    } catch (error) {
      appLogger.error('contacts', `failed to inspect contact session range: ${sessionId}`, error)
    }
  }
  return latest
}

function getSessionFacts(
  adapter: SessionRuntimeAdapter,
  sessionId: string,
  timeRange: ContactsTimeRangeState,
  factsCache: ContactsFactsCacheContext | null
): ContactsSessionFacts {
  const dbVersion = getSessionDbVersion(adapter, sessionId)
  const cached = readSessionFacts(sessionId, timeRange, factsCache, dbVersion)
  if (cached) return cached

  const facts = computeSessionFacts(adapter, sessionId, timeRange)
  writeSessionFacts(adapter, sessionId, timeRange, factsCache, facts, dbVersion)
  return facts
}

function computeSessionFacts(
  adapter: SessionRuntimeAdapter,
  sessionId: string,
  timeRange: ContactsTimeRangeState
): ContactsSessionFacts {
  const db = adapter.openReadonly(sessionId)
  if (!db || !isChatSessionDb(db)) return { kind: 'not_chat_db', latestMessageTs: null }

  const latestMessageTs = getLatestContactMessageTs(db)
  const meta = getSessionMeta(db)
  if (!meta) return { kind: 'missing_meta', latestMessageTs }
  if (meta.type !== ChatType.PRIVATE && meta.type !== ChatType.GROUP)
    return { kind: 'unsupported_type', latestMessageTs }

  const cachedMeta = toContactsSessionMetaFacts(meta)
  if (!meta.ownerId?.trim()) return { kind: 'missing_owner', meta: cachedMeta, latestMessageTs }

  const owner = resolveOwnerMember(db)
  if (!owner) return { kind: 'unresolved_owner', meta: cachedMeta, latestMessageTs }

  if (meta.type === ChatType.PRIVATE) {
    const facts = getPrivateContactFacts(db, owner.id, { startTs: timeRange.startTs })
    if (facts.type === 'missing') return { kind: 'private_missing', meta: cachedMeta, latestMessageTs }
    if (facts.type === 'ambiguous') return { kind: 'private_ambiguous', meta: cachedMeta, latestMessageTs }
    return { kind: 'private', meta: cachedMeta, latestMessageTs, facts }
  }

  return {
    kind: 'group',
    meta: cachedMeta,
    latestMessageTs,
    facts: getGroupContactFacts(db, owner.id, { startTs: timeRange.startTs }),
  }
}

function applySessionFacts(
  accumulators: Map<string, ContactAccumulator>,
  diagnostics: ContactsDiagnostics,
  sessionId: string,
  sessionFacts: ContactsSessionFacts
): void {
  if ('meta' in sessionFacts && sessionFacts.meta.type === ChatType.PRIVATE) diagnostics.privateSessionCount++

  switch (sessionFacts.kind) {
    case 'missing_owner':
      diagnostics.skippedMissingOwnerSessions++
      return
    case 'unresolved_owner':
      diagnostics.skippedUnresolvedOwnerSessions++
      return
    case 'private_ambiguous':
      diagnostics.skippedAmbiguousPrivateSessions++
      return
    case 'private':
      applyPrivateFacts(accumulators, diagnostics, sessionId, sessionFacts.meta, sessionFacts.facts)
      return
    case 'group':
      applyGroupFacts(accumulators, sessionId, sessionFacts.meta, sessionFacts.facts)
      return
    default:
      return
  }
}

function applyPrivateFacts(
  accumulators: Map<string, ContactAccumulator>,
  diagnostics: ContactsDiagnostics,
  sessionId: string,
  meta: ContactsSessionMetaFacts,
  facts: ContactsCachedPrivateFacts
): void {
  if (facts.privateMessageCount <= 0) return
  diagnostics.activePrivateSessionCount++

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

function applyGroupFacts(
  accumulators: Map<string, ContactAccumulator>,
  sessionId: string,
  meta: ContactsSessionMetaFacts,
  sessionFacts: ContactsCachedGroupFacts[]
): void {
  for (const facts of sessionFacts) {
    if (!hasGroupContactSignal(facts)) continue
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

function hasGroupContactSignal(facts: ContactsCachedGroupFacts): boolean {
  return facts.messageCount > 0 || facts.coOccurrenceCount > 0 || facts.replyInteractionCount > 0
}

function createFactsCacheContext(dir: string): ContactsFactsCacheContext {
  return {
    dir,
    latestKey: buildContactsSessionLatestCacheKey(CONTACTS_ALGORITHM_VERSION),
    stats: createEmptyContactsFactsCacheStats(),
  }
}

function readLatestFacts(
  sessionId: string,
  factsCache: ContactsFactsCacheContext | null,
  dbVersion: string
): ContactsSessionLatestFacts | null {
  if (!factsCache) return null
  const cached = readCachedContactsSessionLatest(sessionId, factsCache.dir, factsCache.latestKey, dbVersion)
  if (!cached.hit) {
    factsCache.stats.latestMisses++
    return null
  }
  factsCache.stats.latestHits++
  return cached.data
}

function writeLatestFacts(
  adapter: SessionRuntimeAdapter,
  sessionId: string,
  factsCache: ContactsFactsCacheContext | null,
  data: ContactsSessionLatestFacts,
  expectedDbVersion: string
): void {
  if (!factsCache) return
  const dbVersion = getSessionDbVersion(adapter, sessionId)
  if (dbVersion !== expectedDbVersion) {
    appLogger.debug('contacts', 'skipped contacts latest facts cache write because db version changed', {
      sessionId,
    })
    return
  }
  writeCachedContactsSessionLatest(sessionId, factsCache.dir, factsCache.latestKey, dbVersion, data)
  factsCache.stats.writes++
}

function readSessionFacts(
  sessionId: string,
  timeRange: ContactsTimeRangeState,
  factsCache: ContactsFactsCacheContext | null,
  dbVersion: string
): ContactsSessionFacts | null {
  if (!factsCache) return null
  const cached = readCachedContactsSessionFacts(
    sessionId,
    factsCache.dir,
    buildContactsSessionFactsCacheKey(CONTACTS_ALGORITHM_VERSION, timeRange),
    dbVersion
  )
  if (!cached.hit) {
    factsCache.stats.factsMisses++
    return null
  }
  factsCache.stats.factsHits++
  return cached.data
}

function writeSessionFacts(
  adapter: SessionRuntimeAdapter,
  sessionId: string,
  timeRange: ContactsTimeRangeState,
  factsCache: ContactsFactsCacheContext | null,
  facts: ContactsSessionFacts,
  expectedDbVersion: string
): void {
  if (!factsCache) return
  const dbVersion = getSessionDbVersion(adapter, sessionId)
  if (dbVersion !== expectedDbVersion) {
    appLogger.debug('contacts', 'skipped contacts session facts cache write because db version changed', {
      sessionId,
    })
    return
  }
  writeCachedContactsSessionFacts(
    sessionId,
    factsCache.dir,
    buildContactsSessionFactsCacheKey(CONTACTS_ALGORITHM_VERSION, timeRange),
    dbVersion,
    facts
  )
  writeCachedContactsSessionLatest(sessionId, factsCache.dir, factsCache.latestKey, dbVersion, {
    latestMessageTs: facts.latestMessageTs,
  })
  factsCache.stats.writes += 2
}

function getSessionDbVersion(adapter: SessionRuntimeAdapter, sessionId: string): string {
  return getDbFileVersion(adapter.getDbPath(sessionId))
}

function toContactsSessionMetaFacts(meta: SessionMeta): ContactsSessionMetaFacts {
  return {
    name: meta.name,
    platform: meta.platform,
    type: meta.type as ChatType.PRIVATE | ChatType.GROUP,
    ownerId: meta.ownerId,
  }
}

function buildContactItems(accumulators: ContactAccumulator[]): ContactItem[] {
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
    contacts.push(toContactItem(input.acc, 'friend', score))
  }

  for (const input of nonFriendInputs) {
    const score = nonFriendScores.get(input) ?? { score: 0, scoreBreakdown: {} }
    contacts.push(toContactItem(input.acc, 'non_friend', score))
  }

  return contacts.sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName))
}

function toContactItem(
  acc: ContactAccumulator,
  pool: 'friend' | 'non_friend',
  scoring: { score: number; scoreBreakdown: ContactItem['scoreBreakdown'] }
): ContactItem {
  const aliases = [...acc.aliases].filter((alias) => alias !== acc.displayName)
  const searchText = [acc.displayName, acc.platformId, ...aliases].join(' ').toLowerCase()

  const item: ContactItem = {
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
  if (pool === 'friend') item.friendSource = 'private'
  return item
}

export function createEmptyContactsDiagnostics(): ContactsDiagnostics {
  return createEmptyDiagnostics()
}

function createEmptyDiagnostics(): ContactsDiagnostics {
  return {
    privateSessionCount: 0,
    activePrivateSessionCount: 0,
    contactsEnabled: false,
    skippedMissingOwnerSessions: 0,
    skippedUnresolvedOwnerSessions: 0,
    skippedAmbiguousPrivateSessions: 0,
    skippedInvalidPlatformIdMembers: 0,
    skippedFailedSessions: 0,
    warnings: [],
  }
}

function getOrCreateAccumulator(
  accumulators: Map<string, ContactAccumulator>,
  sessionId: string,
  meta: ContactsSessionMetaFacts,
  contact: ContactMemberRef
): ContactAccumulator {
  const sessionScoped = shouldScopeContactToSession(meta.platform, contact)
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
    aliases: new Set([contact.platformId, contact.name, ...contact.aliases].filter(Boolean)),
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

function shouldScopeContactToSession(platform: ChatPlatform, contact: ContactMemberRef): boolean {
  if (isNameMatchPlatform(platform)) return true
  return platform.trim().toLowerCase() === 'qq' && contact.platformId.trim() === contact.name.trim()
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
  for (const alias of contact.aliases) acc.aliases.add(alias)
  if ((!acc.displayName || acc.displayName === acc.platformId) && contact.name) {
    acc.displayName = contact.name
  }
  if (!acc.avatar && contact.avatar) acc.avatar = contact.avatar
}

function updateLastInteraction(acc: ContactAccumulator, ts: number | null): void {
  if (ts === null) return
  acc.lastInteractionTs = Math.max(acc.lastInteractionTs ?? 0, ts)
}
