import { createHash } from 'node:crypto'
import {
  getNonSystemMembersForContacts,
  getParticipantSessionFacts,
  getMembers,
  getRecentMessages,
  getSearchMessageContext as getCoreSearchMessageContext,
  getSessionMeta,
  getSessionOverview,
  resolveContactMember,
  resolveOwnerMember,
  searchMessagesByKeywords,
  type DatabaseAdapter,
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
  type CrossChatResolvedContact,
  type CrossChatResolvedSession,
  type CrossChatSearchRequest,
  type CrossChatSearchResult,
  type CrossChatSearchScope,
  type CrossChatSessionDescriptor,
  type CrossChatTruncationReason,
  type CrossChatUnresolvedEntity,
} from '@openchatlab/shared-types'
import { appLogger } from '../../logging/app-logger'
import type { SessionRuntimeAdapter } from '../adapters'
import type { ContactsService } from '../contacts'

const DEFAULT_MAX_SESSIONS = 24
const MAX_MAX_SESSIONS = 100
const DEFAULT_MAX_EVIDENCE = 80
const MAX_MAX_EVIDENCE = 200
const DEFAULT_MAX_WALL_TIME_MS = 8_000
const MAX_MAX_WALL_TIME_MS = 30_000
const DEFAULT_CONTEXT_SIZE = 10
const MAX_CONTEXT_SIZE = 50
const SECONDS_PER_DAY = 86400
const MAX_RECENT_DAYS = 3650
const CONTACT_SESSIONS_ALGORITHM_VERSION = 'contact-sessions-v1'
const DEFAULT_INSPECTION_PAGE_SIZE = 50
const MAX_INSPECTION_PAGE_SIZE = 100

export interface CrossChatAnalysisServiceDeps {
  adapter: SessionRuntimeAdapter
  contactsService: Pick<ContactsService, 'getContactDetail' | 'getContactsPage'>
  now?: () => number
}

export interface CrossChatAnalysisService {
  lookupContact(query: string): CrossChatContactLookupResult
  resolveEntities(refs: AIEntityRef[], options?: CrossChatOperationOptions): Promise<CrossChatEntityResolution>
  inspectContactSessions(
    request: CrossChatContactSessionsRequest,
    options?: CrossChatOperationOptions
  ): Promise<CrossChatContactSessionsResult>
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
    const range = normalizeInspectionRange(request.startTs, request.endTs)
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

    const messages: CrossChatMessageSource[] = []
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
        messages.push(...result.messages.map((message) => toCrossChatMessage(candidate.descriptor, message)))
      } catch (error) {
        failedSessionIds.add(candidate.descriptor.sessionId)
        appLogger.warn('cross-chat-analysis', `failed to search session: ${candidate.descriptor.sessionId}`, error)
      } finally {
        processedSessions++
      }
      await yieldToEventLoop()
    }

    const sortMultiplier = request.sort === 'asc' ? 1 : -1
    messages.sort(
      (left, right) =>
        (left.timestamp - right.timestamp ||
          left.sessionId.localeCompare(right.sessionId) ||
          left.messageId - right.messageId) * sortMultiplier
    )
    if (messages.length > maxEvidence) {
      messages.length = maxEvidence
      truncatedReasons.add('evidence_budget')
    }
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
  endTs: number | undefined
): { startTs: number | null; endTs: number | null } {
  const normalizedStart = normalizeOptionalTimestamp(startTs, 'startTs')
  const normalizedEnd = normalizeOptionalTimestamp(endTs, 'endTs')
  if (normalizedStart !== null && normalizedEnd !== null && normalizedStart > normalizedEnd) {
    throw new Error('startTs must be less than or equal to endTs')
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
