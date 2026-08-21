import {
  getMembers,
  getMessageContext as getCoreMessageContext,
  getRecentMessages,
  getSessionMeta,
  getSessionOverview,
  searchMessagesByKeywords,
  type DatabaseAdapter,
} from '@openchatlab/core'
import { ChatType } from '@openchatlab/shared-types'
import type { AIEntityRef } from '../../ai/chats'
import { appLogger } from '../../logging/app-logger'
import type { SessionRuntimeAdapter } from '../adapters'
import type { ContactsService } from '../contacts'
import type {
  CrossChatEntityResolution,
  CrossChatMessageContextRequest,
  CrossChatMessageContextResult,
  CrossChatMessageSource,
  CrossChatOperationOptions,
  CrossChatOverviewItem,
  CrossChatOverviewRequest,
  CrossChatOverviewResult,
  CrossChatResolvedContact,
  CrossChatResolvedSession,
  CrossChatSearchRequest,
  CrossChatSearchResult,
  CrossChatSearchScope,
  CrossChatSessionDescriptor,
  CrossChatTruncationReason,
  CrossChatUnresolvedEntity,
} from './types'

const DEFAULT_MAX_SESSIONS = 24
const MAX_MAX_SESSIONS = 100
const DEFAULT_MAX_EVIDENCE = 80
const MAX_MAX_EVIDENCE = 200
const DEFAULT_MAX_WALL_TIME_MS = 8_000
const MAX_MAX_WALL_TIME_MS = 30_000
const DEFAULT_CONTEXT_SIZE = 10
const MAX_CONTEXT_SIZE = 50

export interface CrossChatAnalysisServiceDeps {
  adapter: SessionRuntimeAdapter
  contactsService: Pick<ContactsService, 'getContactDetail'>
  now?: () => number
}

export interface CrossChatAnalysisService {
  resolveEntities(refs: AIEntityRef[]): CrossChatEntityResolution
  searchMessages(request: CrossChatSearchRequest, options?: CrossChatOperationOptions): Promise<CrossChatSearchResult>
  getMessageContext(request: CrossChatMessageContextRequest): CrossChatMessageContextResult
  getOverview(request: CrossChatOverviewRequest, options?: CrossChatOperationOptions): Promise<CrossChatOverviewResult>
}

export function createCrossChatAnalysisService(deps: CrossChatAnalysisServiceDeps): CrossChatAnalysisService {
  return new DefaultCrossChatAnalysisService(deps)
}

class DefaultCrossChatAnalysisService implements CrossChatAnalysisService {
  constructor(private readonly deps: CrossChatAnalysisServiceDeps) {}

  resolveEntities(refs: AIEntityRef[]): CrossChatEntityResolution {
    const contacts: CrossChatResolvedContact[] = []
    const sessions: CrossChatResolvedSession[] = []
    const unresolved: CrossChatUnresolvedEntity[] = []
    const candidateSessionIds = new Set<string>()
    const resolvedSessionIds = new Set<string>()
    const failedSessionIds = new Set<string>()

    for (const ref of refs) {
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
        continue
      }

      const sourceSessions = contact.sessionScoped
        ? contact.sourceSessions.filter((source) => source.id === contact.sessionId)
        : contact.sourceSessions
      const resolvedContactSessions: CrossChatResolvedContact['sessions'] = []
      const unresolvedContactSessions: string[] = []
      const failedContactSessions: string[] = []

      for (const source of sourceSessions) {
        candidateSessionIds.add(source.id)
        try {
          const db = this.deps.adapter.openReadonly(source.id)
          if (!db) {
            failedContactSessions.push(source.id)
            failedSessionIds.add(source.id)
            continue
          }
          const descriptor = getSessionDescriptor(source.id, db)
          const member = getMembers(db).find((item) => item.platformId === contact.platformId)
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
    }

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

  async searchMessages(
    request: CrossChatSearchRequest,
    options: CrossChatOperationOptions = {}
  ): Promise<CrossChatSearchResult> {
    const keywords = request.keywords.map((keyword) => keyword.trim()).filter(Boolean)
    if (keywords.length === 0) throw new Error('At least one search keyword is required')
    throwIfAborted(options.signal)

    const maxSessions = clampInteger(request.maxSessions, DEFAULT_MAX_SESSIONS, 1, MAX_MAX_SESSIONS)
    const maxEvidence = clampInteger(request.maxEvidence, DEFAULT_MAX_EVIDENCE, 1, MAX_MAX_EVIDENCE)
    const maxWallTimeMs = clampInteger(request.maxWallTimeMs, DEFAULT_MAX_WALL_TIME_MS, 1, MAX_MAX_WALL_TIME_MS)
    const startedAt = this.now()
    const failedSessionIds = new Set<string>()
    const { candidates, candidateSessionCount } = this.resolveSearchCandidates(request.scopes, failedSessionIds)
    const selected = candidates.slice(0, maxSessions)
    const truncatedReasons = new Set<CrossChatTruncationReason>()
    if (candidates.length > selected.length) truncatedReasons.add('session_budget')

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
          startTs: request.startTs,
          endTs: request.endTs,
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
      coverage: {
        candidateSessions: candidateSessionCount,
        scannedSessions,
        matchedSessions,
        failedSessions: failedSessionIds.size,
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
    const messages = getCoreMessageContext(db, [request.messageId], contextSize)
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
    const scopes = normalizeScopes(request.scopes)
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

  private resolveSearchCandidates(
    scopes: CrossChatSearchScope[] | undefined,
    failedSessionIds: Set<string>
  ): { candidates: SearchCandidate[]; candidateSessionCount: number } {
    const normalizedScopes: CrossChatSearchScope[] = scopes
      ? normalizeScopes(scopes)
      : this.deps.adapter.listSessionIds().map((sessionId) => ({ sessionId }))
    const candidates: SearchCandidate[] = []
    for (const scope of normalizedScopes) {
      const descriptor = this.tryGetSessionDescriptor(scope.sessionId)
      if (!descriptor) {
        failedSessionIds.add(scope.sessionId)
        continue
      }
      candidates.push({ descriptor, memberIds: scope.memberIds })
    }
    return {
      candidates: candidates.sort(
        (left, right) =>
          (right.descriptor.lastMessageTs ?? Number.NEGATIVE_INFINITY) -
          (left.descriptor.lastMessageTs ?? Number.NEGATIVE_INFINITY)
      ),
      candidateSessionCount: normalizedScopes.length,
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

interface SearchCandidate {
  descriptor: CrossChatSessionDescriptor
  memberIds?: number[]
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
