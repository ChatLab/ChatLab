import { createHash } from 'node:crypto'
import {
  buildContactKey,
  getCrossChatSessionActivityFacts,
  getNonSystemMembersForContacts,
  getParticipantSessionFacts,
  getParticipantSetInteractionFacts,
  getMembers,
  getRecentMessages,
  getSegmentSummaries,
  getSearchMessageContext as getCoreSearchMessageContext,
  getSessionMeta,
  getSessionOverview,
  resolveContactMember,
  resolveOwnerMember,
  searchMessagesByKeywords,
  shouldScopeContactToSession,
  type ContactMemberRef,
  type DatabaseAdapter,
  type ParticipantSetInteractionFacts,
} from '@openchatlab/core'
import {
  ChatType,
  type AIEntityRef,
  type CrossChatContactCandidate,
  type CrossChatContactLookupResult,
  type CrossChatContactSessionsRequest,
  type CrossChatContactSessionsResult,
  type CrossChatEntityResolution,
  type CrossChatMessageContextRequest,
  type CrossChatMessageContextResult,
  type CrossChatMessageSource,
  type CrossChatOperationOptions,
  type CrossChatOverviewItem,
  type CrossChatOverviewRequest,
  type CrossChatOverviewResult,
  type CrossChatParticipantRef,
  type CrossChatPrivateContactRankItem,
  type CrossChatPrivateContactsRankingRequest,
  type CrossChatPrivateContactsRankingResult,
  type CrossChatRecentSessionResult,
  type CrossChatResolvedContact,
  type CrossChatResolvedSession,
  type CrossChatSearchRequest,
  type CrossChatSearchResult,
  type CrossChatSearchScope,
  type CrossChatSharedInteractionsRequest,
  type CrossChatSharedInteractionsResult,
  type CrossChatSessionDescriptor,
  type CrossChatTruncationReason,
  type CrossChatUnresolvedEntity,
} from '@openchatlab/shared-types'
import { appLogger } from '../../logging/app-logger'
import type { SessionRuntimeAdapter } from '../adapters'
import type { ContactsService } from '../contacts'

const DEFAULT_MAX_SESSIONS = 24
const MAX_MAX_SESSIONS = 100
const DEFAULT_MAX_EVIDENCE = 1_000
const MAX_MAX_EVIDENCE = 1_000
const DEFAULT_MAX_WALL_TIME_MS = 8_000
const MAX_MAX_WALL_TIME_MS = 30_000
const DEFAULT_CONTEXT_SIZE = 10
const MAX_CONTEXT_SIZE = 50
const RECENT_SESSION_MESSAGE_LIMIT = 200
const RECENT_SESSION_SUMMARY_LIMIT = 5
const SEARCH_CONTEXT_BEFORE = 2
const SEARCH_CONTEXT_AFTER = 2
const SECONDS_PER_DAY = 86400
const MAX_RECENT_DAYS = 3650
const CONTACT_SESSIONS_ALGORITHM_VERSION = 'contact-sessions-v1'
const DEFAULT_INSPECTION_PAGE_SIZE = 50
const MAX_INSPECTION_PAGE_SIZE = 100
const SHARED_INTERACTIONS_ALGORITHM_VERSION = 'shared-interactions-v1'
const PROXIMITY_ALGORITHM_VERSION = 'lookahead-3-decay-120-gap-1800-v2'
const DEFAULT_SHARED_INTERACTIONS_PAGE_SIZE = 20
const MAX_SHARED_INTERACTIONS_PAGE_SIZE = 50
const DEFAULT_MAX_ANCHORS_PER_PAIR = 4
const MAX_MAX_ANCHORS_PER_PAIR = 8
const PRIVATE_CONTACTS_RANKING_ALGORITHM_VERSION = 'private-contacts-ranking-v1'
const DEFAULT_RANKING_LIMIT = 10
const MAX_RANKING_LIMIT = 50
const RANKING_MAX_WALL_TIME_MS = 30_000

export interface CrossChatAnalysisServiceDeps {
  adapter: SessionRuntimeAdapter
  contactsService: Pick<ContactsService, 'getContactDetail' | 'getContactsPage'>
  getExcludedSessionIds?: () => readonly string[]
  now?: () => number
}

export interface CrossChatAnalysisService {
  lookupContact(query: string): CrossChatContactLookupResult
  resolveEntities(refs: AIEntityRef[], options?: CrossChatOperationOptions): Promise<CrossChatEntityResolution>
  inspectContactSessions(
    request: CrossChatContactSessionsRequest,
    options?: CrossChatOperationOptions
  ): Promise<CrossChatContactSessionsResult>
  inspectSharedInteractions(
    request: CrossChatSharedInteractionsRequest,
    options?: CrossChatOperationOptions
  ): Promise<CrossChatSharedInteractionsResult>
  readRecentSession(sessionId: string): CrossChatRecentSessionResult
  rankPrivateContacts(
    request: CrossChatPrivateContactsRankingRequest,
    options?: CrossChatOperationOptions
  ): Promise<CrossChatPrivateContactsRankingResult>
  searchMessages(request: CrossChatSearchRequest, options?: CrossChatOperationOptions): Promise<CrossChatSearchResult>
  getMessageContext(request: CrossChatMessageContextRequest): CrossChatMessageContextResult
  getOverview(request: CrossChatOverviewRequest, options?: CrossChatOperationOptions): Promise<CrossChatOverviewResult>
}

export function createCrossChatAnalysisService(deps: CrossChatAnalysisServiceDeps): CrossChatAnalysisService {
  return new DefaultCrossChatAnalysisService(deps)
}

class DefaultCrossChatAnalysisService implements CrossChatAnalysisService {
  constructor(private readonly deps: CrossChatAnalysisServiceDeps) {}

  lookupContact(rawQuery: string): CrossChatContactLookupResult {
    const query = rawQuery.trim()
    const response = this.deps.contactsService.getContactsPage({
      acceptStale: true,
      page: 1,
      pageSize: 200,
      query,
      timeRangePreset: 'all',
    })
    const normalizedQuery = normalizeContactName(query)
    const exactMatches = response.contacts.filter((contact) =>
      [contact.displayName, ...contact.aliases].some((name) => normalizeContactName(name) === normalizedQuery)
    )
    const matchedContacts = exactMatches.length > 0 ? exactMatches : response.contacts
    const totalCandidates = exactMatches.length > 0 ? exactMatches.length : response.pagination.total
    const candidates = matchedContacts.slice(0, 8).map((contact): CrossChatContactCandidate => {
      const detail = this.deps.contactsService.getContactDetail(contact.key, {
        acceptStale: true,
        timeRangePreset: 'all',
      })
      return {
        contactKey: contact.key,
        displayName: contact.displayName,
        platform: contact.platform,
        aliases: contact.aliases,
        sourceSessions:
          detail.contact?.sourceSessions.map((session) => ({
            id: session.id,
            name: session.name,
            type: session.type,
          })) ?? [],
      }
    })
    const status: CrossChatContactLookupResult['status'] =
      totalCandidates === 1
        ? 'resolved'
        : totalCandidates > 1
          ? 'ambiguous'
          : response.cache.status === 'missing' || response.task?.status === 'running'
            ? 'unavailable'
            : 'not_found'
    return {
      query,
      status,
      cacheStatus: response.cache.status,
      totalCandidates,
      candidates,
    }
  }

  async resolveEntities(
    refs: AIEntityRef[],
    options: CrossChatOperationOptions = {}
  ): Promise<CrossChatEntityResolution> {
    throwIfAborted(options.signal)
    const contacts: CrossChatResolvedContact[] = []
    const sessions: CrossChatResolvedSession[] = []
    const unresolved: CrossChatUnresolvedEntity[] = []
    const candidateSessionIds = new Set<string>()
    const resolvedSessionIds = new Set<string>()
    const failedSessionIds = new Set<string>()

    for (const ref of refs) {
      throwIfAborted(options.signal)
      if (ref.type === 'session') {
        candidateSessionIds.add(ref.sessionId)
        const descriptor = this.tryGetSessionDescriptor(ref.sessionId)
        if (descriptor) {
          resolvedSessionIds.add(ref.sessionId)
          sessions.push({ ref, status: 'resolved', session: descriptor })
        } else {
          failedSessionIds.add(ref.sessionId)
          sessions.push({ ref, status: 'unresolved' })
          unresolved.push({ ref, reason: 'session_not_found' })
        }
        await yieldToEventLoop()
        continue
      }

      const detail = this.deps.contactsService.getContactDetail(ref.contactKey, {
        acceptStale: true,
        timeRangePreset: 'all',
      })
      const contact = detail.contact
      if (!contact) {
        contacts.push({
          ref,
          status: 'unresolved',
          cacheStatus: detail.cache.status,
          sessions: [],
          unresolvedSessionIds: [],
          failedSessionIds: [],
        })
        unresolved.push({
          ref,
          reason: detail.cache.status === 'missing' ? 'contact_snapshot_missing' : 'contact_not_found',
        })
        await yieldToEventLoop()
        continue
      }

      const sourceSessions = contact.sessionScoped
        ? contact.sourceSessions.filter((source) => source.id === contact.sessionId)
        : contact.sourceSessions
      const resolvedContactSessions: CrossChatResolvedContact['sessions'] = []
      const unresolvedContactSessions: string[] = []
      const failedContactSessions: string[] = []

      // 实体解析必须保留联系人全部精确来源；逐库让出事件循环，使长列表仍能及时响应取消。
      for (const source of sourceSessions) {
        throwIfAborted(options.signal)
        candidateSessionIds.add(source.id)
        try {
          const db = this.deps.adapter.openReadonly(source.id)
          if (!db) {
            failedContactSessions.push(source.id)
            failedSessionIds.add(source.id)
            continue
          }
          const descriptor = getSessionDescriptor(source.id, db)
          const member = resolveContactMember(db, contact.platformId)
          if (!descriptor || !member) {
            unresolvedContactSessions.push(source.id)
            continue
          }
          resolvedContactSessions.push({
            ...descriptor,
            memberId: member.id,
            memberPlatformId: member.platformId,
            memberName: member.name,
          })
          resolvedSessionIds.add(source.id)
        } catch (error) {
          failedContactSessions.push(source.id)
          failedSessionIds.add(source.id)
          appLogger.warn('cross-chat-analysis', `failed to resolve contact in source session: ${source.id}`, error)
        } finally {
          await yieldToEventLoop()
        }
      }

      const status =
        resolvedContactSessions.length === 0
          ? 'unresolved'
          : unresolvedContactSessions.length > 0 || failedContactSessions.length > 0
            ? 'partial'
            : 'resolved'
      contacts.push({
        ref,
        status,
        cacheStatus: detail.cache.status,
        sessions: resolvedContactSessions,
        unresolvedSessionIds: unresolvedContactSessions,
        failedSessionIds: failedContactSessions,
      })
      if (status === 'unresolved') unresolved.push({ ref, reason: 'member_not_found' })
      if (sourceSessions.length === 0) await yieldToEventLoop()
    }

    throwIfAborted(options.signal)

    return {
      contacts,
      sessions,
      unresolved,
      coverage: {
        requestedEntities: refs.length,
        resolvedEntities:
          contacts.filter((item) => item.status !== 'unresolved').length +
          sessions.filter((item) => item.status === 'resolved').length,
        candidateSessions: candidateSessionIds.size,
        resolvedSessions: resolvedSessionIds.size,
        failedSessions: failedSessionIds.size,
      },
    }
  }

  async inspectContactSessions(
    request: CrossChatContactSessionsRequest,
    options: CrossChatOperationOptions = {}
  ): Promise<CrossChatContactSessionsResult> {
    throwIfAborted(options.signal)
    const contactKey = request.contactKey.trim()
    if (!contactKey) throw new Error('contactKey is required')
    const range = normalizeInspectionRange(request.startTs, request.endTs, request.recentDays, () => this.now())
    const includeRosterOnly = request.includeRosterOnly !== false
    const pageSize = clampInteger(request.pageSize, DEFAULT_INSPECTION_PAGE_SIZE, 1, MAX_INSPECTION_PAGE_SIZE)
    const maxWallTimeMs = clampInteger(request.maxWallTimeMs, DEFAULT_MAX_WALL_TIME_MS, 1, MAX_MAX_WALL_TIME_MS)
    const detail = this.deps.contactsService.getContactDetail(contactKey, {
      acceptStale: true,
      timeRangePreset: 'all',
    })
    const contact = detail.contact
    if (!contact) {
      return emptyContactSessionsResult(detail.cache.status, range)
    }

    const startedAt = this.now()
    const candidateSessionIds = contact.sessionScoped
      ? contact.sessionId
        ? [contact.sessionId]
        : []
      : [...new Set(this.deps.adapter.listSessionCandidateIds?.() ?? this.deps.adapter.listSessionIds())].sort(
          (left, right) => left.localeCompare(right)
        )
    const cursorFingerprint = createInspectionFingerprint({
      candidateSessionIds,
      contactKey,
      startTs: range.startTs,
      endTs: range.endTs,
      includeRosterOnly,
    })
    const cursor = parseInspectionCursor(request.cursor, cursorFingerprint, candidateSessionIds)
    const sessions: CrossChatContactSessionsResult['sessions'] = []
    const failedSessionIds: string[] = []
    const truncatedReasons = new Set<CrossChatContactSessionsResult['coverage']['truncatedReasons'][number]>()
    let scannedSessions = 0
    let nextCandidateIndex = cursor.nextCandidateIndex
    let dataEarliestMessageTs: number | null = null
    let dataLatestMessageTs: number | null = null

    options.onProgress?.({ processedSessions: 0, totalSessions: candidateSessionIds.length })
    while (nextCandidateIndex < candidateSessionIds.length && sessions.length < pageSize) {
      throwIfAborted(options.signal)
      if (this.now() - startedAt >= maxWallTimeMs) {
        truncatedReasons.add('time_budget')
        break
      }
      const sessionId = candidateSessionIds[nextCandidateIndex]
      options.onProgress?.({
        processedSessions: nextCandidateIndex,
        totalSessions: candidateSessionIds.length,
        currentSessionId: sessionId,
      })
      try {
        const db = this.deps.adapter.openReadonly(sessionId)
        if (!db) {
          failedSessionIds.push(sessionId)
        } else {
          const descriptor = getSessionDescriptor(sessionId, db)
          const meta = getSessionMeta(db)
          if (descriptor && meta?.platform === contact.platform) {
            const member = getNonSystemMembersForContacts(db).find((item) => item.platformId === contact.platformId)
            if (member) {
              const facts = getParticipantSessionFacts(db, member.id, range)
              if (includeRosterOnly || facts.ownMessageCount > 0) {
                sessions.push({
                  ...descriptor,
                  memberId: member.id,
                  memberName: member.name,
                  presence: facts.ownMessageCount > 0 ? 'spoke' : 'roster_only',
                  presenceObservedInRange: facts.ownMessageCount > 0,
                  ownMessageCount: facts.ownMessageCount,
                  sessionMessageCount: facts.sessionMessageCount,
                  messageShare:
                    facts.sessionMessageCount > 0 ? facts.ownMessageCount / facts.sessionMessageCount : null,
                  firstOwnMessageTs: facts.firstOwnMessageTs,
                  lastOwnMessageTs: facts.lastOwnMessageTs,
                  activeDays: facts.activeDays,
                  memberCount: descriptor.sessionType === ChatType.GROUP ? facts.memberCount : null,
                  sessionFirstMessageTs: facts.sessionFirstMessageTs,
                  lastMessageTs: facts.sessionLastMessageTs,
                })
                dataEarliestMessageTs = minNullable(dataEarliestMessageTs, facts.sessionFirstMessageTs)
                dataLatestMessageTs = maxNullable(dataLatestMessageTs, facts.sessionLastMessageTs)
              }
            }
          }
        }
      } catch (error) {
        failedSessionIds.push(sessionId)
        appLogger.warn('cross-chat-analysis', `failed to inspect contact session: ${sessionId}`, error)
      } finally {
        scannedSessions++
        nextCandidateIndex++
      }
      await yieldToEventLoop()
    }

    if (sessions.length >= pageSize && nextCandidateIndex < candidateSessionIds.length) {
      truncatedReasons.add('page_size')
    }
    const complete = nextCandidateIndex >= candidateSessionIds.length
    const nextCursor = complete
      ? null
      : createInspectionCursor(cursorFingerprint, candidateSessionIds[nextCandidateIndex - 1] ?? null)
    options.onProgress?.({ processedSessions: nextCandidateIndex, totalSessions: candidateSessionIds.length })

    return {
      algorithmVersion: CONTACT_SESSIONS_ALGORITHM_VERSION,
      contact: {
        contactKey: contact.key,
        displayName: contact.displayName,
        platform: contact.platform,
        sessionScoped: contact.sessionScoped,
      },
      appliedRange: {
        ...range,
        dataEarliestMessageTs,
        dataLatestMessageTs,
      },
      summary: summarizeContactSessions(sessions, !request.cursor && complete),
      sessions,
      coverage: {
        candidateSessions: candidateSessionIds.length,
        scannedSessions,
        matchedSessions: sessions.length,
        returnedSessions: sessions.length,
        failedSessions: failedSessionIds.length,
        failedSessionIds,
        complete,
        nextCursor,
        truncated: truncatedReasons.size > 0,
        truncatedReasons: [...truncatedReasons],
        contactCacheStatus: detail.cache.status,
      },
    }
  }

  async inspectSharedInteractions(
    request: CrossChatSharedInteractionsRequest,
    options: CrossChatOperationOptions = {}
  ): Promise<CrossChatSharedInteractionsResult> {
    throwIfAborted(options.signal)
    const participantRefs = normalizeParticipantRefs(request.participants)
    const range = normalizeInspectionRange(request.startTs, request.endTs, request.recentDays, () => this.now())
    const pageSize = clampInteger(
      request.pageSize,
      DEFAULT_SHARED_INTERACTIONS_PAGE_SIZE,
      1,
      MAX_SHARED_INTERACTIONS_PAGE_SIZE
    )
    const maxAnchorsPerPair = clampInteger(
      request.maxAnchorsPerPair,
      DEFAULT_MAX_ANCHORS_PER_PAIR,
      0,
      MAX_MAX_ANCHORS_PER_PAIR
    )
    const maxWallTimeMs = clampInteger(request.maxWallTimeMs, DEFAULT_MAX_WALL_TIME_MS, 1, MAX_MAX_WALL_TIME_MS)
    const startedAt = this.now()
    const resolvedParticipants = participantRefs.map((ref, index) => {
      if (ref.type === 'owner') {
        return {
          index,
          ref,
          status: 'resolved' as const,
          displayName: 'owner',
          platform: undefined,
          cacheStatus: undefined,
          contact: undefined,
        }
      }
      const detail = this.deps.contactsService.getContactDetail(ref.contactKey, {
        acceptStale: true,
        timeRangePreset: 'all',
      })
      return {
        index,
        ref,
        status: detail.contact ? ('resolved' as const) : ('unresolved' as const),
        displayName: detail.contact?.displayName ?? ref.contactKey,
        platform: detail.contact?.platform,
        cacheStatus: detail.cache.status,
        contact: detail.contact,
      }
    })
    const unresolvedParticipantIndexes = resolvedParticipants
      .filter((participant) => participant.status === 'unresolved')
      .map((participant) => participant.index)
    const publicParticipants = resolvedParticipants.map(({ contact: _contact, ...participant }) => participant)
    if (unresolvedParticipantIndexes.length > 0) {
      return emptySharedInteractionsResult(publicParticipants, unresolvedParticipantIndexes, range)
    }

    throwIfAborted(options.signal)
    const sessionScopedIds = resolvedParticipants
      .flatMap((participant) =>
        participant.ref.type === 'contact' && participant.contact?.sessionScoped && participant.contact.sessionId
          ? [participant.contact.sessionId]
          : []
      )
      .filter((sessionId, index, all) => all.indexOf(sessionId) === index)
    const candidateSessionIds = (
      sessionScopedIds.length > 1
        ? []
        : sessionScopedIds.length === 1
          ? sessionScopedIds
          : [...new Set(this.deps.adapter.listSessionCandidateIds?.() ?? this.deps.adapter.listSessionIds())]
    ).sort((left, right) => left.localeCompare(right))
    throwIfAborted(options.signal)
    const cursorFingerprint = createInspectionFingerprint({
      candidateSessionIds,
      participantRefs,
      startTs: range.startTs,
      endTs: range.endTs,
      maxAnchorsPerPair,
    })
    const cursor = parseInspectionCursor(request.cursor, cursorFingerprint, candidateSessionIds)
    const sessions: CrossChatSharedInteractionsResult['sessions'] = []
    const failedSessionIds: string[] = []
    const truncatedReasons = new Set<CrossChatSharedInteractionsResult['coverage']['truncatedReasons'][number]>()
    const ownerResolution = participantRefs.some((ref) => ref.type === 'owner')
      ? { resolvedSessions: 0, missingOwnerSessions: 0, unresolvedOwnerSessions: 0 }
      : undefined
    let identityCollisionSessions = 0
    let scannedSessions = 0
    let nextCandidateIndex = cursor.nextCandidateIndex
    let dataEarliestMessageTs: number | null = null
    let dataLatestMessageTs: number | null = null

    options.onProgress?.({ processedSessions: 0, totalSessions: candidateSessionIds.length })
    while (nextCandidateIndex < candidateSessionIds.length && sessions.length < pageSize) {
      throwIfAborted(options.signal)
      if (this.now() - startedAt >= maxWallTimeMs) {
        truncatedReasons.add('time_budget')
        break
      }
      const sessionId = candidateSessionIds[nextCandidateIndex]
      options.onProgress?.({
        processedSessions: nextCandidateIndex,
        totalSessions: candidateSessionIds.length,
        currentSessionId: sessionId,
      })
      try {
        const db = this.deps.adapter.openReadonly(sessionId)
        if (!db) {
          failedSessionIds.push(sessionId)
        } else {
          const descriptor = getSessionDescriptor(sessionId, db)
          const meta = getSessionMeta(db)
          if (descriptor && meta) {
            const members = getNonSystemMembersForContacts(db)
            const participantMembers = resolvedParticipants.map((participant) => {
              if (participant.ref.type === 'owner') {
                if (!meta.ownerId?.trim()) {
                  if (ownerResolution) ownerResolution.missingOwnerSessions++
                  return null
                }
                const owner = members.find((member) => member.platformId === meta.ownerId)
                if (!owner) {
                  if (ownerResolution) ownerResolution.unresolvedOwnerSessions++
                  return null
                }
                if (ownerResolution) ownerResolution.resolvedSessions++
                return owner
              }
              if (!participant.contact || participant.contact.platform !== meta.platform) return null
              return members.find((member) => member.platformId === participant.contact?.platformId) ?? null
            })
            if (participantMembers.every((member) => member !== null)) {
              const resolvedMembers = participantMembers.filter((member) => member !== null)
              if (new Set(resolvedMembers.map((member) => member.id)).size !== resolvedMembers.length) {
                identityCollisionSessions++
              } else {
                const facts = getParticipantSetInteractionFacts(
                  db,
                  resolvedMembers.map((member) => member.id),
                  {
                    ...range,
                    maxAnchorsPerPair,
                  }
                )
                const participantIndexByMemberId = new Map(
                  resolvedMembers.map((member, index) => [member.id, resolvedParticipants[index].index])
                )
                const item = mapSharedInteractionSession(descriptor, resolvedMembers, participantIndexByMemberId, facts)
                sessions.push(item)
                dataEarliestMessageTs = minNullable(dataEarliestMessageTs, facts.sessionFirstMessageTs)
                dataLatestMessageTs = maxNullable(dataLatestMessageTs, facts.sessionLastMessageTs)
                if (facts.proximityStatus !== 'complete') truncatedReasons.add('message_budget')
              }
            }
          }
        }
      } catch (error) {
        failedSessionIds.push(sessionId)
        appLogger.warn('cross-chat-analysis', `failed to inspect shared interactions: ${sessionId}`, error)
      } finally {
        scannedSessions++
        nextCandidateIndex++
      }
      await yieldToEventLoop()
    }

    if (sessions.length >= pageSize && nextCandidateIndex < candidateSessionIds.length) {
      truncatedReasons.add('page_size')
    }
    sessions.sort(compareSharedInteractionSessions)
    const complete = nextCandidateIndex >= candidateSessionIds.length
    const nextCursor = complete
      ? null
      : createInspectionCursor(cursorFingerprint, candidateSessionIds[nextCandidateIndex - 1] ?? null)
    options.onProgress?.({ processedSessions: nextCandidateIndex, totalSessions: candidateSessionIds.length })

    return {
      algorithmVersion: SHARED_INTERACTIONS_ALGORITHM_VERSION,
      proximityAlgorithmVersion: PROXIMITY_ALGORITHM_VERSION,
      participants: publicParticipants,
      appliedRange: {
        ...range,
        dataEarliestMessageTs,
        dataLatestMessageTs,
      },
      summary: summarizeSharedInteractions(sessions, !request.cursor && complete),
      sessions,
      coverage: {
        candidateSessions: candidateSessionIds.length,
        scannedSessions,
        matchedSessions: sessions.length,
        returnedSessions: sessions.length,
        failedSessions: failedSessionIds.length,
        failedSessionIds,
        complete,
        nextCursor,
        truncated: truncatedReasons.size > 0,
        truncatedReasons: [...truncatedReasons],
        unresolvedParticipantIndexes,
        identityCollisionSessions,
        ownerResolution,
      },
    }
  }

  async searchMessages(
    request: CrossChatSearchRequest,
    options: CrossChatOperationOptions = {}
  ): Promise<CrossChatSearchResult> {
    const keywords = request.keywords.map((keyword) => keyword.trim()).filter(Boolean)
    if (keywords.length === 0 && (!request.scopes || request.scopes.length === 0)) {
      throw new Error('At least one search keyword is required for an unscoped search')
    }
    throwIfAborted(options.signal)

    const sender = request.sender === 'owner' ? 'owner' : 'all'
    const recentDays = normalizeRecentDays(request.recentDays)
    const effectiveRecentDays = request.startTs === undefined ? recentDays : undefined
    let startTs = request.startTs
    let endTs = request.endTs
    if (effectiveRecentDays !== undefined) {
      endTs ??= Math.floor(this.now() / 1000)
      startTs = endTs - effectiveRecentDays * SECONDS_PER_DAY
    }
    const ownerResolution =
      sender === 'owner' ? { resolvedSessions: 0, missingOwnerSessions: 0, unresolvedOwnerSessions: 0 } : undefined

    const maxSessions = clampInteger(request.maxSessions, DEFAULT_MAX_SESSIONS, 1, MAX_MAX_SESSIONS)
    const maxEvidence = clampInteger(request.maxEvidence, DEFAULT_MAX_EVIDENCE, 1, MAX_MAX_EVIDENCE)
    const maxWallTimeMs = clampInteger(request.maxWallTimeMs, DEFAULT_MAX_WALL_TIME_MS, 1, MAX_MAX_WALL_TIME_MS)
    const startedAt = this.now()
    const failedSessionIds = new Set<string>()
    const { candidates, candidateSessionCount, eligibleCandidateCount, timedOut } = await this.resolveSearchCandidates(
      request.scopes,
      failedSessionIds,
      sender,
      ownerResolution,
      maxSessions,
      startedAt + maxWallTimeMs,
      options.signal
    )
    const selected = candidates
    const truncatedReasons = new Set<CrossChatTruncationReason>()
    if (eligibleCandidateCount > selected.length) truncatedReasons.add('session_budget')
    if (timedOut) truncatedReasons.add('time_budget')

    const sessionResults: SessionSearchResult[] = []
    let totalMatches = 0
    let scannedSessions = 0
    let matchedSessions = 0
    let processedSessions = 0

    options.onProgress?.({ processedSessions: 0, totalSessions: selected.length })
    for (const [index, candidate] of selected.entries()) {
      throwIfAborted(options.signal)
      if (this.now() - startedAt >= maxWallTimeMs) {
        truncatedReasons.add('time_budget')
        break
      }
      options.onProgress?.({
        processedSessions: index,
        totalSessions: selected.length,
        currentSessionId: candidate.descriptor.sessionId,
      })
      throwIfAborted(options.signal)

      try {
        const db = this.deps.adapter.openReadonly(candidate.descriptor.sessionId)
        if (!db) {
          failedSessionIds.add(candidate.descriptor.sessionId)
          continue
        }
        const result = searchMessagesByKeywords(db, keywords, {
          startTs,
          endTs,
          senderIds: candidate.memberIds,
          matchMode: request.matchMode,
          sort: request.sort,
          limit: maxEvidence,
        })
        scannedSessions++
        totalMatches += result.total ?? result.messages.length
        if (result.messages.length > 0) matchedSessions++
        if ((result.total ?? result.messages.length) > result.messages.length) truncatedReasons.add('evidence_budget')
        sessionResults.push({
          candidate,
          db,
          totalMatches: result.total ?? result.messages.length,
          matches: result.messages.map((message) => ({
            ...toCrossChatMessage(candidate.descriptor, message),
            evidenceRole: 'match' as const,
          })),
        })
      } catch (error) {
        failedSessionIds.add(candidate.descriptor.sessionId)
        appLogger.warn('cross-chat-analysis', `failed to search session: ${candidate.descriptor.sessionId}`, error)
      } finally {
        processedSessions++
      }
      await yieldToEventLoop()
    }

    sessionResults.sort(compareSessionSearchResults)
    const evidence = collectSearchEvidence(sessionResults, maxEvidence, startTs, endTs, {
      deadline: startedAt + maxWallTimeMs,
      now: () => this.now(),
      signal: options.signal,
    })
    const messages = evidence.messages
    if (evidence.timedOut) truncatedReasons.add('time_budget')
    const returnedMatchCount = messages.filter((message) => message.evidenceRole === 'match').length
    if (returnedMatchCount < totalMatches) truncatedReasons.add('evidence_budget')

    const sortMultiplier = request.sort === 'asc' ? 1 : -1
    messages.sort(
      (left, right) =>
        (left.timestamp - right.timestamp ||
          left.sessionId.localeCompare(right.sessionId) ||
          left.messageId - right.messageId) * sortMultiplier
    )
    options.onProgress?.({ processedSessions, totalSessions: selected.length })

    return {
      messages,
      totalMatches,
      appliedFilters: {
        startTs: startTs ?? null,
        endTs: endTs ?? null,
        recentDays: effectiveRecentDays ?? null,
        sender,
      },
      coverage: {
        candidateSessions: candidateSessionCount,
        scannedSessions,
        matchedSessions,
        failedSessions: failedSessionIds.size,
        ownerResolution,
        truncated: truncatedReasons.size > 0,
        truncatedReasons: [...truncatedReasons],
      },
    }
  }

  readRecentSession(sessionId: string): CrossChatRecentSessionResult {
    const db = this.deps.adapter.ensureReadonly(sessionId)
    const descriptor = getSessionDescriptor(sessionId, db)
    if (!descriptor) throw createNotFoundError(`Session not found: ${sessionId}`)

    const recent = searchMessagesByKeywords(db, [], {
      sort: 'desc',
      limit: RECENT_SESSION_MESSAGE_LIMIT,
    })
    const summaries = getSegmentSummaries(db, { limit: RECENT_SESSION_SUMMARY_LIMIT })
      .filter((segment): segment is typeof segment & { summary: string } => typeof segment.summary === 'string')
      .map((segment) => ({
        segmentId: segment.id,
        startTs: segment.startTs,
        endTs: segment.endTs,
        messageCount: segment.messageCount,
        participants: segment.participants,
        summary: segment.summary,
      }))
    const messages = recent.messages.map((message) => toCrossChatMessage(descriptor, message))
    const totalMessages = recent.total ?? messages.length

    return {
      source: descriptor,
      messages,
      summaries,
      coverage: {
        totalMessages,
        returnedMessages: messages.length,
        returnedSummaries: summaries.length,
        hasEarlierMessages: totalMessages > messages.length,
      },
    }
  }

  async rankPrivateContacts(
    request: CrossChatPrivateContactsRankingRequest,
    options: CrossChatOperationOptions = {}
  ): Promise<CrossChatPrivateContactsRankingResult> {
    throwIfAborted(options.signal)
    const range = normalizeInspectionRange(request.startTs, request.endTs, request.recentDays, () => this.now())
    const rankBy = request.rankBy === 'active_days' ? 'active_days' : 'message_count'
    const limit = clampInteger(request.limit, DEFAULT_RANKING_LIMIT, 1, MAX_RANKING_LIMIT)
    const excludedSessionIds = new Set(this.deps.getExcludedSessionIds?.() ?? [])
    const sessionIds = this.deps.adapter.listSessionCandidateIds?.() ?? this.deps.adapter.listSessionIds()
    const deadline = this.now() + RANKING_MAX_WALL_TIME_MS
    const accumulators = new Map<string, PrivateContactRankAccumulator>()
    const failedSessionIds: string[] = []
    const coverage = {
      candidateSessions: 0,
      scannedSessions: 0,
      analyzedSessions: 0,
      excludedSessions: 0,
      missingOwnerSessions: 0,
      unresolvedOwnerSessions: 0,
      missingContactSessions: 0,
      ambiguousContactSessions: 0,
      failedSessions: 0,
      failedSessionIds,
      complete: true,
      truncated: false,
      truncatedReasons: [] as Array<'time_budget'>,
    }
    let dataEarliestMessageTs: number | null = null
    let dataLatestMessageTs: number | null = null
    let processedSessions = 0

    options.onProgress?.({ processedSessions: 0, totalSessions: sessionIds.length })
    for (const [index, sessionId] of sessionIds.entries()) {
      throwIfAborted(options.signal)
      if (this.now() >= deadline) {
        coverage.truncated = true
        coverage.truncatedReasons.push('time_budget')
        break
      }
      options.onProgress?.({ processedSessions: index, totalSessions: sessionIds.length, currentSessionId: sessionId })
      try {
        const db = this.deps.adapter.openReadonly(sessionId)
        if (!db) {
          coverage.failedSessions++
          failedSessionIds.push(sessionId)
          continue
        }
        const descriptor = getSessionDescriptor(sessionId, db)
        if (!descriptor || descriptor.sessionType !== ChatType.PRIVATE) continue
        coverage.candidateSessions++
        coverage.scannedSessions++
        if (excludedSessionIds.has(sessionId)) {
          coverage.excludedSessions++
          continue
        }

        const facts = getCrossChatSessionActivityFacts(db, range)
        dataEarliestMessageTs = minNullable(dataEarliestMessageTs, facts.dataEarliestMessageTs)
        dataLatestMessageTs = maxNullable(dataLatestMessageTs, facts.dataLatestMessageTs)
        const meta = getSessionMeta(db)
        if (!meta?.ownerId?.trim()) {
          coverage.missingOwnerSessions++
          continue
        }
        const owner = resolveOwnerMember(db)
        if (!owner) {
          coverage.unresolvedOwnerSessions++
          continue
        }
        const candidates = getNonSystemMembersForContacts(db).filter((member) => member.id !== owner.id)
        if (candidates.length === 0) {
          coverage.missingContactSessions++
          continue
        }
        const activeMemberIds = new Set(
          facts.members.filter((member) => member.messageCount > 0).map((member) => member.memberId)
        )
        const activeCandidates = candidates.filter((candidate) => activeMemberIds.has(candidate.id))
        const resolvedCandidates = activeCandidates.length > 0 ? activeCandidates : candidates
        if (resolvedCandidates.length > 1) {
          coverage.ambiguousContactSessions++
          continue
        }

        coverage.analyzedSessions++
        if (facts.totalMessages === 0) continue
        const contact = resolvedCandidates[0]
        const contactKey = buildContactKey(
          descriptor.platform,
          contact.platformId,
          shouldScopeContactToSession(descriptor.platform, contact) ? sessionId : undefined
        )
        const ownerActivity = facts.members.find((member) => member.memberId === owner.id)
        const contactActivity = facts.members.find((member) => member.memberId === contact.id)
        const accumulator = accumulators.get(contactKey) ?? {
          contactKey,
          displayName: contact.name,
          platform: descriptor.platform,
          totalMessages: 0,
          ownerMessages: 0,
          contactMessages: 0,
          activeDayKeys: new Set<string>(),
          firstMessageTs: null,
          lastMessageTs: null,
          sessionIds: [],
        }
        accumulator.totalMessages += facts.totalMessages
        accumulator.ownerMessages += ownerActivity?.messageCount ?? 0
        accumulator.contactMessages += contactActivity?.messageCount ?? 0
        facts.activeDayKeys.forEach((day) => accumulator.activeDayKeys.add(day))
        accumulator.firstMessageTs = minNullable(accumulator.firstMessageTs, facts.firstMessageTs)
        accumulator.lastMessageTs = maxNullable(accumulator.lastMessageTs, facts.lastMessageTs)
        accumulator.sessionIds.push(sessionId)
        accumulators.set(contactKey, accumulator)
      } catch (error) {
        coverage.failedSessions++
        failedSessionIds.push(sessionId)
        appLogger.warn('cross-chat-analysis', `failed to rank private session: ${sessionId}`, error)
      } finally {
        processedSessions = index + 1
        await yieldToEventLoop()
      }
    }
    options.onProgress?.({ processedSessions, totalSessions: sessionIds.length })

    coverage.complete =
      !coverage.truncated &&
      coverage.failedSessions === 0 &&
      coverage.missingOwnerSessions === 0 &&
      coverage.unresolvedOwnerSessions === 0 &&
      coverage.missingContactSessions === 0 &&
      coverage.ambiguousContactSessions === 0
    const ranked = [...accumulators.values()].sort((left, right) =>
      comparePrivateContactRankAccumulators(left, right, rankBy)
    )
    const items: CrossChatPrivateContactRankItem[] = ranked.slice(0, limit).map((item, index) => ({
      rank: index + 1,
      contactKey: item.contactKey,
      displayName: item.displayName,
      platform: item.platform,
      totalMessages: item.totalMessages,
      ownerMessages: item.ownerMessages,
      contactMessages: item.contactMessages,
      activeDays: item.activeDayKeys.size,
      firstMessageTs: item.firstMessageTs,
      lastMessageTs: item.lastMessageTs,
      sessionIds: [...item.sessionIds].sort(),
    }))
    const currentTs = Math.floor(this.now() / 1000)
    return {
      algorithmVersion: PRIVATE_CONTACTS_RANKING_ALGORITHM_VERSION,
      rankBy,
      appliedRange: {
        ...range,
        dataEarliestMessageTs,
        dataLatestMessageTs,
        currentTs,
      },
      items,
      coverage,
    }
  }

  getMessageContext(request: CrossChatMessageContextRequest): CrossChatMessageContextResult {
    const db = this.deps.adapter.ensureReadonly(request.sessionId)
    const descriptor = getSessionDescriptor(request.sessionId, db)
    if (!descriptor) throw createNotFoundError(`Session not found: ${request.sessionId}`)
    const contextSize = clampInteger(request.contextSize, DEFAULT_CONTEXT_SIZE, 0, MAX_CONTEXT_SIZE)
    const messages = getCoreSearchMessageContext(db, [request.messageId], contextSize, contextSize)
    if (!messages.some((message) => message.id === request.messageId)) {
      throw createNotFoundError(`Message not found: ${request.messageId}`)
    }
    return {
      source: descriptor,
      messages: messages.map((message) => toCrossChatMessage(descriptor, message)),
    }
  }

  async getOverview(
    request: CrossChatOverviewRequest,
    options: CrossChatOperationOptions = {}
  ): Promise<CrossChatOverviewResult> {
    throwIfAborted(options.signal)
    const scopes = normalizeOverviewScopes(request.scopes)
    const maxSessions = clampInteger(request.maxSessions, DEFAULT_MAX_SESSIONS, 1, MAX_MAX_SESSIONS)
    const maxWallTimeMs = clampInteger(request.maxWallTimeMs, DEFAULT_MAX_WALL_TIME_MS, 1, MAX_MAX_WALL_TIME_MS)
    const selected = scopes.slice(0, maxSessions)
    const startedAt = this.now()
    const items: CrossChatOverviewItem[] = []
    let failedSessions = 0
    let processedSessions = 0
    const truncatedReasons = new Set<'session_budget' | 'time_budget'>()
    if (selected.length < scopes.length) truncatedReasons.add('session_budget')

    options.onProgress?.({ processedSessions: 0, totalSessions: selected.length })
    for (const [index, scope] of selected.entries()) {
      throwIfAborted(options.signal)
      if (this.now() - startedAt >= maxWallTimeMs) {
        truncatedReasons.add('time_budget')
        break
      }
      options.onProgress?.({
        processedSessions: index,
        totalSessions: selected.length,
        currentSessionId: scope.sessionId,
      })
      throwIfAborted(options.signal)
      try {
        const db = this.deps.adapter.openReadonly(scope.sessionId)
        if (!db) {
          failedSessions++
          continue
        }
        const descriptor = getSessionDescriptor(scope.sessionId, db)
        if (!descriptor) {
          failedSessions++
          continue
        }
        items.push(buildOverviewItem(descriptor, db, scope))
      } catch (error) {
        failedSessions++
        appLogger.warn('cross-chat-analysis', `failed to build session overview: ${scope.sessionId}`, error)
      } finally {
        processedSessions++
      }
      await yieldToEventLoop()
    }
    options.onProgress?.({ processedSessions, totalSessions: selected.length })
    return {
      items,
      coverage: {
        candidateSessions: scopes.length,
        analyzedSessions: items.length,
        failedSessions,
        truncated: truncatedReasons.size > 0,
        truncatedReasons: [...truncatedReasons],
      },
    }
  }

  private async resolveSearchCandidates(
    scopes: CrossChatSearchScope[] | undefined,
    failedSessionIds: Set<string>,
    sender: 'all' | 'owner',
    ownerResolution?: {
      resolvedSessions: number
      missingOwnerSessions: number
      unresolvedOwnerSessions: number
    },
    maxSessions = DEFAULT_MAX_SESSIONS,
    deadline = Number.POSITIVE_INFINITY,
    signal?: AbortSignal
  ): Promise<{
    candidates: SearchCandidate[]
    candidateSessionCount: number
    eligibleCandidateCount: number
    timedOut: boolean
  }> {
    throwIfAborted(signal)
    const normalizedScopes: CrossChatSearchScope[] = scopes
      ? normalizeScopes(scopes)
      : (this.deps.adapter.listSessionCandidateIds?.() ?? this.deps.adapter.listSessionIds()).map((sessionId) => ({
          sessionId,
        }))
    const candidates: SearchCandidate[] = []
    let eligibleCandidateCount = 0
    let timedOut = false
    for (const scope of normalizedScopes) {
      throwIfAborted(signal)
      if (this.now() >= deadline) {
        timedOut = true
        break
      }
      const descriptor = this.tryGetSessionDescriptor(scope.sessionId)
      if (!descriptor) {
        failedSessionIds.add(scope.sessionId)
        await yieldToEventLoop()
        continue
      }
      if (this.now() >= deadline) {
        timedOut = true
        break
      }
      if (sender === 'owner') {
        const db = this.deps.adapter.openReadonly(scope.sessionId)
        if (!db) {
          failedSessionIds.add(scope.sessionId)
          await yieldToEventLoop()
          continue
        }
        const meta = getSessionMeta(db)
        if (!meta?.ownerId?.trim()) {
          if (ownerResolution) ownerResolution.missingOwnerSessions++
          await yieldToEventLoop()
          continue
        }
        const owner = resolveOwnerMember(db)
        if (!owner) {
          if (ownerResolution) ownerResolution.unresolvedOwnerSessions++
          await yieldToEventLoop()
          continue
        }
        if (ownerResolution) ownerResolution.resolvedSessions++
        eligibleCandidateCount++
        addBoundedSearchCandidate(candidates, { descriptor, memberIds: [owner.id] }, maxSessions)
      } else {
        eligibleCandidateCount++
        addBoundedSearchCandidate(candidates, { descriptor, memberIds: scope.memberIds }, maxSessions)
      }
      await yieldToEventLoop()
    }
    throwIfAborted(signal)
    if (!timedOut && this.now() >= deadline) timedOut = true
    return {
      candidates,
      candidateSessionCount: normalizedScopes.length,
      eligibleCandidateCount,
      timedOut,
    }
  }

  private tryGetSessionDescriptor(sessionId: string): CrossChatSessionDescriptor | null {
    try {
      const db = this.deps.adapter.openReadonly(sessionId)
      return db ? getSessionDescriptor(sessionId, db) : null
    } catch (error) {
      appLogger.warn('cross-chat-analysis', `failed to inspect session metadata: ${sessionId}`, error)
      return null
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }
}

function normalizeContactName(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function normalizeRecentDays(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value <= 0) throw new Error('recentDays must be a positive number')
  return Math.min(MAX_RECENT_DAYS, Math.max(1, Math.floor(value)))
}

interface SearchCandidate {
  descriptor: CrossChatSessionDescriptor
  memberIds?: number[]
}

interface PrivateContactRankAccumulator {
  contactKey: string
  displayName: string
  platform: CrossChatPrivateContactRankItem['platform']
  totalMessages: number
  ownerMessages: number
  contactMessages: number
  activeDayKeys: Set<string>
  firstMessageTs: number | null
  lastMessageTs: number | null
  sessionIds: string[]
}

function comparePrivateContactRankAccumulators(
  left: PrivateContactRankAccumulator,
  right: PrivateContactRankAccumulator,
  rankBy: CrossChatPrivateContactsRankingResult['rankBy']
): number {
  const primaryDifference =
    rankBy === 'active_days'
      ? right.activeDayKeys.size - left.activeDayKeys.size
      : right.totalMessages - left.totalMessages
  return (
    primaryDifference ||
    (right.lastMessageTs ?? Number.NEGATIVE_INFINITY) - (left.lastMessageTs ?? Number.NEGATIVE_INFINITY) ||
    left.contactKey.localeCompare(right.contactKey)
  )
}

interface SessionSearchResult {
  candidate: SearchCandidate
  db: DatabaseAdapter
  totalMatches: number
  matches: CrossChatMessageSource[]
}

function compareSessionSearchResults(left: SessionSearchResult, right: SessionSearchResult): number {
  const leftPrivate = left.candidate.descriptor.sessionType === ChatType.PRIVATE
  const rightPrivate = right.candidate.descriptor.sessionType === ChatType.PRIVATE
  if (leftPrivate !== rightPrivate) return leftPrivate ? -1 : 1
  return (
    right.totalMatches - left.totalMatches ||
    (right.candidate.descriptor.lastMessageTs ?? Number.NEGATIVE_INFINITY) -
      (left.candidate.descriptor.lastMessageTs ?? Number.NEGATIVE_INFINITY)
  )
}

function collectSearchEvidence(
  results: SessionSearchResult[],
  maxMessages: number,
  startTs?: number,
  endTs?: number,
  options: { deadline: number; now: () => number; signal?: AbortSignal } = {
    deadline: Number.POSITIVE_INFINITY,
    now: Date.now,
  }
): { messages: CrossChatMessageSource[]; timedOut: boolean } {
  const selected = new Map<string, CrossChatMessageSource>()
  let timedOut = false

  for (const result of results) {
    let matchIndex = 0
    while (matchIndex < result.matches.length && selected.size < maxMessages) {
      throwIfAborted(options.signal)
      if (options.now() >= options.deadline) {
        timedOut = true
        break
      }
      const remaining = maxMessages - selected.size
      const expectedBlockSize = SEARCH_CONTEXT_BEFORE + SEARCH_CONTEXT_AFTER + 1
      const batchSize = Math.min(
        result.matches.length - matchIndex,
        remaining < expectedBlockSize ? 1 : Math.max(1, Math.floor(remaining / expectedBlockSize))
      )
      const batch = result.matches.slice(matchIndex, matchIndex + batchSize)
      const matchIds = new Set(batch.map((message) => message.messageId))
      const contextMessages = getCoreSearchMessageContext(
        result.db,
        [...matchIds],
        SEARCH_CONTEXT_BEFORE,
        SEARCH_CONTEXT_AFTER
      )
        .map((message) => ({
          ...toCrossChatMessage(result.candidate.descriptor, message),
          evidenceRole: matchIds.has(message.id) ? ('match' as const) : ('context' as const),
        }))
        .filter((message) => isWithinSearchRange(message.timestamp, startTs, endTs))

      for (const matchId of matchIds) {
        const key = crossChatMessageKey(result.candidate.descriptor.sessionId, matchId)
        const existing = selected.get(key)
        if (existing?.evidenceRole === 'context') selected.set(key, { ...existing, evidenceRole: 'match' })
      }

      const unseen = contextMessages.filter(
        (message) => !selected.has(crossChatMessageKey(message.sessionId, message.messageId))
      )
      const accepted =
        unseen.length <= remaining ? unseen : prioritizeContextMessages(unseen, matchIds).slice(0, remaining)
      for (const message of accepted) {
        const key = crossChatMessageKey(message.sessionId, message.messageId)
        const existing = selected.get(key)
        if (!existing || (existing.evidenceRole === 'context' && message.evidenceRole === 'match')) {
          selected.set(key, message)
        }
      }
      matchIndex += batchSize
    }
    if (timedOut || selected.size >= maxMessages) break
  }

  return { messages: [...selected.values()], timedOut }
}

function prioritizeContextMessages(
  messages: CrossChatMessageSource[],
  matchIds: Set<number>
): CrossChatMessageSource[] {
  return [...messages].sort((left, right) => {
    const leftMatch = matchIds.has(left.messageId)
    const rightMatch = matchIds.has(right.messageId)
    if (leftMatch !== rightMatch) return leftMatch ? -1 : 1
    const leftDistance = nearestMessageIdDistance(left.messageId, matchIds)
    const rightDistance = nearestMessageIdDistance(right.messageId, matchIds)
    return leftDistance - rightDistance || left.messageId - right.messageId
  })
}

function nearestMessageIdDistance(messageId: number, matchIds: Set<number>): number {
  let distance = Number.POSITIVE_INFINITY
  for (const matchId of matchIds) distance = Math.min(distance, Math.abs(messageId - matchId))
  return distance
}

function crossChatMessageKey(sessionId: string, messageId: number): string {
  return `${sessionId}:${messageId}`
}

function isWithinSearchRange(timestamp: number, startTs: number | undefined, endTs: number | undefined): boolean {
  return (startTs === undefined || timestamp >= startTs) && (endTs === undefined || timestamp <= endTs)
}

function addBoundedSearchCandidate(
  candidates: SearchCandidate[],
  candidate: SearchCandidate,
  maxSessions: number
): void {
  candidates.push(candidate)
  candidates.sort(compareSearchCandidates)
  if (candidates.length > maxSessions) candidates.length = maxSessions
}

function compareSearchCandidates(left: SearchCandidate, right: SearchCandidate): number {
  return (
    (right.descriptor.lastMessageTs ?? Number.NEGATIVE_INFINITY) -
    (left.descriptor.lastMessageTs ?? Number.NEGATIVE_INFINITY)
  )
}

function getSessionDescriptor(sessionId: string, db: DatabaseAdapter): CrossChatSessionDescriptor | null {
  const meta = getSessionMeta(db)
  if (!meta || (meta.type !== ChatType.PRIVATE && meta.type !== ChatType.GROUP)) return null
  const latest = getRecentMessages(db, { limit: 1 })[0]
  return {
    sessionId,
    sessionName: meta.name,
    sessionType: meta.type,
    platform: meta.platform,
    lastMessageTs: latest?.timestamp ?? null,
  }
}

function toCrossChatMessage(
  descriptor: CrossChatSessionDescriptor,
  message: {
    id: number
    senderId: number
    senderName: string
    senderPlatformId: string
    content: string
    timestamp: number
    type: number
  }
): CrossChatMessageSource {
  return {
    ...descriptor,
    messageId: message.id,
    senderId: message.senderId,
    senderName: message.senderName,
    senderPlatformId: message.senderPlatformId,
    content: message.content,
    timestamp: message.timestamp,
    messageType: message.type,
  }
}

function normalizeScopes(scopes: CrossChatSearchScope[]): CrossChatSearchScope[] {
  const bySession = new Map<string, CrossChatSearchScope>()
  for (const scope of scopes) {
    const sessionId = scope.sessionId.trim()
    if (!sessionId) continue
    const existing = bySession.get(sessionId)
    if (!existing) {
      bySession.set(sessionId, {
        sessionId,
        memberIds: scope.memberIds ? [...new Set(scope.memberIds)] : undefined,
        label: scope.label,
      })
      continue
    }
    if (!existing.memberIds || !scope.memberIds) {
      existing.memberIds = undefined
    } else {
      existing.memberIds = [...new Set([...existing.memberIds, ...scope.memberIds])]
    }
    existing.label ??= scope.label
  }
  return [...bySession.values()]
}

function normalizeOverviewScopes(scopes: CrossChatSearchScope[]): CrossChatSearchScope[] {
  return scopes.flatMap((scope) => {
    const sessionId = scope.sessionId.trim()
    if (!sessionId) return []
    return [
      {
        sessionId,
        memberIds: scope.memberIds ? [...new Set(scope.memberIds)] : undefined,
        label: scope.label,
      },
    ]
  })
}

function buildOverviewItem(
  descriptor: CrossChatSessionDescriptor,
  db: DatabaseAdapter,
  scope: CrossChatSearchScope
): CrossChatOverviewItem {
  if (!scope.memberIds) {
    const overview = getSessionOverview(db)
    return {
      ...descriptor,
      label: scope.label ?? descriptor.sessionName,
      totalMessages: overview.totalMessages,
      firstMessageTs: overview.firstMessageTs,
      lastMessageTs: overview.lastMessageTs,
    }
  }

  const members = getMembers(db)
  const memberNames = members.filter((member) => scope.memberIds?.includes(member.id)).map((member) => member.name)
  const latest = searchMessagesByKeywords(db, [], { senderIds: scope.memberIds, sort: 'desc', limit: 1 })
  const earliest = searchMessagesByKeywords(db, [], { senderIds: scope.memberIds, sort: 'asc', limit: 1 })
  return {
    ...descriptor,
    label: scope.label ?? descriptor.sessionName,
    memberIds: scope.memberIds,
    memberNames,
    totalMessages: latest.total ?? 0,
    firstMessageTs: earliest.messages[0]?.timestamp ?? null,
    lastMessageTs: latest.messages[0]?.timestamp ?? null,
  }
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value as number)))
}

function normalizeInspectionRange(
  startTs: number | undefined,
  endTs: number | undefined,
  recentDays: number | undefined,
  now: () => number
): { startTs: number | null; endTs: number | null } {
  const normalizedStart = normalizeOptionalTimestamp(startTs, 'startTs')
  const normalizedEnd = normalizeOptionalTimestamp(endTs, 'endTs')
  if (normalizedStart !== null && normalizedEnd !== null && normalizedStart > normalizedEnd) {
    throw new Error('startTs must be less than or equal to endTs')
  }
  const normalizedRecentDays = normalizedStart === null ? normalizeRecentDays(recentDays) : undefined
  if (normalizedRecentDays !== undefined) {
    const effectiveEnd = normalizedEnd ?? Math.floor(now() / 1000)
    return {
      startTs: effectiveEnd - normalizedRecentDays * SECONDS_PER_DAY,
      endTs: effectiveEnd,
    }
  }
  return { startTs: normalizedStart, endTs: normalizedEnd }
}

function normalizeOptionalTimestamp(value: number | undefined, name: string): number | null {
  if (value === undefined) return null
  if (!Number.isFinite(value)) throw new Error(`${name} must be a finite timestamp`)
  return Math.floor(value)
}

function summarizeContactSessions(
  sessions: CrossChatContactSessionsResult['sessions'],
  completeResult: boolean
): CrossChatContactSessionsResult['summary'] {
  let ownMessageCount = 0
  let firstOwnMessageTs: number | null = null
  let lastOwnMessageTs: number | null = null
  let privateSessions = 0
  let groupSessions = 0
  let spokeSessions = 0
  let rosterOnlySessions = 0
  for (const session of sessions) {
    ownMessageCount += session.ownMessageCount
    firstOwnMessageTs = minNullable(firstOwnMessageTs, session.firstOwnMessageTs)
    lastOwnMessageTs = maxNullable(lastOwnMessageTs, session.lastOwnMessageTs)
    if (session.sessionType === ChatType.PRIVATE) privateSessions++
    else groupSessions++
    if (session.presence === 'spoke') spokeSessions++
    else rosterOnlySessions++
  }
  return {
    scope: completeResult ? 'complete_result' : 'current_batch',
    matchedSessions: sessions.length,
    privateSessions,
    groupSessions,
    spokeSessions,
    rosterOnlySessions,
    ownMessageCount,
    firstOwnMessageTs,
    lastOwnMessageTs,
  }
}

function normalizeParticipantRefs(participants: CrossChatParticipantRef[]): CrossChatParticipantRef[] {
  if (!Array.isArray(participants)) throw new Error('participants must be an array')
  const deduplicated = new Map<string, CrossChatParticipantRef>()
  for (const participant of participants) {
    if (participant?.type === 'owner') {
      deduplicated.set('owner', { type: 'owner' })
      continue
    }
    if (participant?.type === 'contact') {
      const contactKey = participant.contactKey?.trim()
      if (!contactKey) throw new Error('participant contactKey is required')
      deduplicated.set(`contact:${contactKey}`, { type: 'contact', contactKey })
      continue
    }
    throw new Error('participant type must be owner or contact')
  }
  const refs = [...deduplicated.values()]
  if (refs.length < 2 || refs.length > 5) throw new Error('participants must contain 2 to 5 distinct people')
  return refs
}

function mapSharedInteractionSession(
  descriptor: CrossChatSessionDescriptor,
  members: ContactMemberRef[],
  participantIndexByMemberId: Map<number, number>,
  facts: ParticipantSetInteractionFacts
): CrossChatSharedInteractionsResult['sessions'][number] {
  const participants = facts.participants.map((participant, index) => ({
    participantIndex: participantIndexByMemberId.get(participant.memberId) ?? index,
    memberId: participant.memberId,
    memberName: members[index]?.name ?? String(participant.memberId),
    messageCount: participant.messageCount,
    firstMessageTs: participant.firstMessageTs,
    lastMessageTs: participant.lastMessageTs,
    activeDays: participant.activeDays,
    presenceObservedInRange: participant.messageCount > 0,
  }))
  const pairs = facts.pairs.map((pair) => ({
    sourceParticipantIndex: participantIndexByMemberId.get(pair.sourceMemberId) ?? 0,
    targetParticipantIndex: participantIndexByMemberId.get(pair.targetMemberId) ?? 0,
    directReplyCount: pair.directReplyCount,
    repliesFromSourceToTarget: pair.repliesFromSourceToTarget,
    repliesFromTargetToSource: pair.repliesFromTargetToSource,
    lastDirectReplyTs: pair.lastDirectReplyTs,
    coOccurrenceCount: pair.coOccurrenceCount,
    coOccurrenceRawScore: pair.coOccurrenceRawScore,
    lastProximityTs: pair.lastProximityTs,
    coActiveDays: pair.coActiveDays,
    anchors: pair.anchors.map((anchor) => ({
      sessionId: descriptor.sessionId,
      messageId: anchor.messageId,
      relatedMessageId: anchor.relatedMessageId,
      timestamp: anchor.timestamp,
      signal: anchor.signal,
      fromParticipantIndex: participantIndexByMemberId.get(anchor.fromMemberId) ?? 0,
      toParticipantIndex: participantIndexByMemberId.get(anchor.toMemberId) ?? 0,
    })),
    anchorsTruncated: pair.anchorsTruncated,
  }))
  const priorityReasons: CrossChatSharedInteractionsResult['sessions'][number]['priorityReasons'] = []
  if (pairs.some((pair) => pair.directReplyCount > 0)) priorityReasons.push('has_direct_reply')
  if (pairs.some((pair) => (pair.coOccurrenceCount ?? 0) > 0)) priorityReasons.push('has_proximity')
  if (participants.every((participant) => participant.presenceObservedInRange)) {
    priorityReasons.push('all_participants_spoke')
  }
  return {
    ...descriptor,
    lastMessageTs: facts.sessionLastMessageTs,
    memberCount: descriptor.sessionType === ChatType.GROUP ? facts.memberCount : null,
    participants,
    overlapRange: facts.overlapRange,
    allParticipantsCoActiveDays: facts.allParticipantsCoActiveDays,
    pairs,
    priorityReasons,
    proximityStatus: facts.proximityStatus,
  }
}

function summarizeSharedInteractions(
  sessions: CrossChatSharedInteractionsResult['sessions'],
  completeResult: boolean
): CrossChatSharedInteractionsResult['summary'] {
  return {
    scope: completeResult ? 'complete_result' : 'current_batch',
    commonSessions: sessions.length,
    commonPrivateSessions: sessions.filter((session) => session.sessionType === ChatType.PRIVATE).length,
    commonGroupSessions: sessions.filter((session) => session.sessionType === ChatType.GROUP).length,
    sessionsWithDirectReplies: sessions.filter((session) => session.pairs.some((pair) => pair.directReplyCount > 0))
      .length,
    sessionsWithProximitySignals: sessions.filter((session) =>
      session.pairs.some((pair) => (pair.coOccurrenceCount ?? 0) > 0)
    ).length,
  }
}

function emptySharedInteractionsResult(
  participants: CrossChatSharedInteractionsResult['participants'],
  unresolvedParticipantIndexes: number[],
  range: { startTs: number | null; endTs: number | null }
): CrossChatSharedInteractionsResult {
  return {
    algorithmVersion: SHARED_INTERACTIONS_ALGORITHM_VERSION,
    proximityAlgorithmVersion: PROXIMITY_ALGORITHM_VERSION,
    participants,
    appliedRange: {
      ...range,
      dataEarliestMessageTs: null,
      dataLatestMessageTs: null,
    },
    summary: {
      scope: 'complete_result',
      commonSessions: 0,
      commonPrivateSessions: 0,
      commonGroupSessions: 0,
      sessionsWithDirectReplies: 0,
      sessionsWithProximitySignals: 0,
    },
    sessions: [],
    coverage: {
      candidateSessions: 0,
      scannedSessions: 0,
      matchedSessions: 0,
      returnedSessions: 0,
      failedSessions: 0,
      failedSessionIds: [],
      complete: true,
      nextCursor: null,
      truncated: false,
      truncatedReasons: [],
      unresolvedParticipantIndexes,
      identityCollisionSessions: 0,
      ownerResolution: participants.some((participant) => participant.ref.type === 'owner')
        ? { resolvedSessions: 0, missingOwnerSessions: 0, unresolvedOwnerSessions: 0 }
        : undefined,
    },
  }
}

function compareSharedInteractionSessions(
  left: CrossChatSharedInteractionsResult['sessions'][number],
  right: CrossChatSharedInteractionsResult['sessions'][number]
): number {
  const leftReplies = left.pairs.reduce((sum, pair) => sum + pair.directReplyCount, 0)
  const rightReplies = right.pairs.reduce((sum, pair) => sum + pair.directReplyCount, 0)
  if (leftReplies !== rightReplies) return rightReplies - leftReplies
  const leftProximity = left.pairs.reduce((sum, pair) => sum + (pair.coOccurrenceRawScore ?? 0), 0)
  const rightProximity = right.pairs.reduce((sum, pair) => sum + (pair.coOccurrenceRawScore ?? 0), 0)
  if (leftProximity !== rightProximity) return rightProximity - leftProximity
  const leftCoActiveDays = left.pairs.reduce((sum, pair) => sum + pair.coActiveDays, 0)
  const rightCoActiveDays = right.pairs.reduce((sum, pair) => sum + pair.coActiveDays, 0)
  if (leftCoActiveDays !== rightCoActiveDays) return rightCoActiveDays - leftCoActiveDays
  const leftLastInteractionTs = latestPairInteractionTs(left.pairs)
  const rightLastInteractionTs = latestPairInteractionTs(right.pairs)
  if (leftLastInteractionTs !== rightLastInteractionTs) return rightLastInteractionTs - leftLastInteractionTs
  if (left.memberCount !== right.memberCount) {
    return (left.memberCount ?? Number.POSITIVE_INFINITY) - (right.memberCount ?? Number.POSITIVE_INFINITY)
  }
  return left.sessionId.localeCompare(right.sessionId)
}

function latestPairInteractionTs(pairs: CrossChatSharedInteractionsResult['sessions'][number]['pairs']): number {
  let latest = 0
  for (const pair of pairs) {
    latest = Math.max(latest, pair.lastDirectReplyTs ?? 0, pair.lastProximityTs ?? 0)
  }
  return latest
}

function emptyContactSessionsResult(
  contactCacheStatus: CrossChatContactSessionsResult['coverage']['contactCacheStatus'],
  range: { startTs: number | null; endTs: number | null }
): CrossChatContactSessionsResult {
  return {
    algorithmVersion: CONTACT_SESSIONS_ALGORITHM_VERSION,
    contact: null,
    appliedRange: {
      ...range,
      dataEarliestMessageTs: null,
      dataLatestMessageTs: null,
    },
    summary: {
      scope: 'complete_result',
      matchedSessions: 0,
      privateSessions: 0,
      groupSessions: 0,
      spokeSessions: 0,
      rosterOnlySessions: 0,
      ownMessageCount: 0,
      firstOwnMessageTs: null,
      lastOwnMessageTs: null,
    },
    sessions: [],
    coverage: {
      candidateSessions: 0,
      scannedSessions: 0,
      matchedSessions: 0,
      returnedSessions: 0,
      failedSessions: 0,
      failedSessionIds: [],
      complete: true,
      nextCursor: null,
      truncated: false,
      truncatedReasons: [],
      contactCacheStatus,
    },
  }
}

function minNullable(left: number | null, right: number | null): number | null {
  if (left === null) return right
  if (right === null) return left
  return Math.min(left, right)
}

function maxNullable(left: number | null, right: number | null): number | null {
  if (left === null) return right
  if (right === null) return left
  return Math.max(left, right)
}

interface InspectionCursorPayload {
  version: 1
  fingerprint: string
  afterSessionId: string | null
}

function createInspectionFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('base64url')
}

function createInspectionCursor(fingerprint: string, afterSessionId: string | null): string {
  const payload: InspectionCursorPayload = { version: 1, fingerprint, afterSessionId }
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

function parseInspectionCursor(
  value: string | undefined,
  fingerprint: string,
  candidateSessionIds: string[]
): { nextCandidateIndex: number } {
  if (!value) return { nextCandidateIndex: 0 }
  try {
    const payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<InspectionCursorPayload>
    if (payload.version !== 1 || payload.fingerprint !== fingerprint) throw new Error('cursor mismatch')
    if (payload.afterSessionId === null) return { nextCandidateIndex: 0 }
    if (typeof payload.afterSessionId !== 'string') throw new Error('cursor session is missing')
    const index = candidateSessionIds.indexOf(payload.afterSessionId)
    if (index < 0) throw new Error('cursor session no longer exists')
    return { nextCandidateIndex: index + 1 }
  } catch {
    throw new Error('cursor is invalid or does not match the current inspection request')
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('Cross-chat analysis was interrupted')
  error.name = 'AbortError'
  throw error
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function createNotFoundError(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 404 })
}
