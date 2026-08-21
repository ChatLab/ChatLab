import type { ChatPlatform, ChatType, ContactsCacheStatus } from '@openchatlab/shared-types'
import type { AIEntityRef } from '../../ai/chats'

export interface CrossChatSessionDescriptor {
  sessionId: string
  sessionName: string
  sessionType: ChatType
  platform: ChatPlatform
  lastMessageTs: number | null
}

export interface CrossChatResolvedContactSession extends CrossChatSessionDescriptor {
  memberId: number
  memberPlatformId: string
  memberName: string
}

export interface CrossChatResolvedContact {
  ref: Extract<AIEntityRef, { type: 'contact' }>
  status: 'resolved' | 'partial' | 'unresolved'
  cacheStatus: ContactsCacheStatus
  sessions: CrossChatResolvedContactSession[]
  unresolvedSessionIds: string[]
  failedSessionIds: string[]
}

export interface CrossChatResolvedSession {
  ref: Extract<AIEntityRef, { type: 'session' }>
  status: 'resolved' | 'unresolved'
  session?: CrossChatSessionDescriptor
}

export interface CrossChatUnresolvedEntity {
  ref: AIEntityRef
  reason: 'contact_snapshot_missing' | 'contact_not_found' | 'session_not_found' | 'member_not_found'
}

export interface CrossChatEntityResolution {
  contacts: CrossChatResolvedContact[]
  sessions: CrossChatResolvedSession[]
  unresolved: CrossChatUnresolvedEntity[]
  coverage: {
    requestedEntities: number
    resolvedEntities: number
    candidateSessions: number
    resolvedSessions: number
    failedSessions: number
  }
}

export interface CrossChatSearchScope {
  sessionId: string
  memberIds?: number[]
  label?: string
}

export interface CrossChatSearchRequest {
  keywords: string[]
  scopes?: CrossChatSearchScope[]
  startTs?: number
  endTs?: number
  matchMode?: 'any' | 'all'
  sort?: 'asc' | 'desc'
  maxSessions?: number
  maxEvidence?: number
  maxWallTimeMs?: number
}

export interface CrossChatSearchProgress {
  processedSessions: number
  totalSessions: number
  currentSessionId?: string
}

export interface CrossChatOperationOptions {
  signal?: AbortSignal
  onProgress?: (progress: CrossChatSearchProgress) => void
}

export interface CrossChatMessageSource extends CrossChatSessionDescriptor {
  messageId: number
  senderId: number
  senderName: string
  senderPlatformId: string
  content: string
  timestamp: number
  messageType: number
}

export type CrossChatTruncationReason = 'session_budget' | 'evidence_budget' | 'time_budget'

export interface CrossChatSearchResult {
  messages: CrossChatMessageSource[]
  totalMatches: number
  coverage: {
    candidateSessions: number
    scannedSessions: number
    matchedSessions: number
    failedSessions: number
    truncated: boolean
    truncatedReasons: CrossChatTruncationReason[]
  }
}

export interface CrossChatMessageContextRequest {
  sessionId: string
  messageId: number
  contextSize?: number
}

export interface CrossChatMessageContextResult {
  source: CrossChatSessionDescriptor
  messages: CrossChatMessageSource[]
}

export interface CrossChatOverviewRequest {
  scopes: CrossChatSearchScope[]
  maxSessions?: number
  maxWallTimeMs?: number
}

export interface CrossChatOverviewItem extends CrossChatSessionDescriptor {
  label: string
  memberIds?: number[]
  memberNames?: string[]
  totalMessages: number
  firstMessageTs: number | null
  lastMessageTs: number | null
}

export interface CrossChatOverviewResult {
  items: CrossChatOverviewItem[]
  coverage: {
    candidateSessions: number
    analyzedSessions: number
    failedSessions: number
    truncated: boolean
    truncatedReasons: Array<'session_budget' | 'time_budget'>
  }
}
