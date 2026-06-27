import { ChatType, type ChatPlatform, type ContactsTimeRangeState } from '@openchatlab/shared-types'
import type { ContactMemberRef, RelationshipGraphEdgeFact, RelationshipGraphMemberFact } from '@openchatlab/core'
import { deleteSessionCache, getCache, setCache } from '../../../cache/session-cache'

export const PEOPLE_RELATIONSHIPS_FACTS_FORMAT_VERSION = 1

export interface PeopleRelationshipsFactsCacheStats {
  latestHits: number
  latestMisses: number
  factsHits: number
  factsMisses: number
  writes: number
}

export interface PeopleRelationshipsSessionMetaFacts {
  name: string
  platform: ChatPlatform
  type: ChatType.PRIVATE | ChatType.GROUP
  ownerId: string | null
}

export interface PeopleRelationshipsCachedPrivateFacts {
  contact: ContactMemberRef
  privateMessageCount: number
  activeMonths: string[]
  lastMessageTs: number | null
}

export interface PeopleRelationshipsCachedGroupFacts {
  members: RelationshipGraphMemberFact[]
  edges: RelationshipGraphEdgeFact[]
}

export type PeopleRelationshipsSessionFacts =
  | { kind: 'not_chat_db'; latestMessageTs: null }
  | { kind: 'missing_meta'; latestMessageTs: number | null }
  | { kind: 'unsupported_type'; latestMessageTs: number | null }
  | { kind: 'missing_owner'; meta: PeopleRelationshipsSessionMetaFacts; latestMessageTs: number | null }
  | { kind: 'unresolved_owner'; meta: PeopleRelationshipsSessionMetaFacts; latestMessageTs: number | null }
  | { kind: 'private_missing'; meta: PeopleRelationshipsSessionMetaFacts; latestMessageTs: number | null }
  | { kind: 'private_ambiguous'; meta: PeopleRelationshipsSessionMetaFacts; latestMessageTs: number | null }
  | {
      kind: 'private'
      meta: PeopleRelationshipsSessionMetaFacts
      latestMessageTs: number | null
      facts: PeopleRelationshipsCachedPrivateFacts
    }
  | {
      kind: 'group'
      meta: PeopleRelationshipsSessionMetaFacts
      latestMessageTs: number | null
      facts: PeopleRelationshipsCachedGroupFacts
    }

export interface PeopleRelationshipsSessionLatestFacts {
  latestMessageTs: number | null
}

export type PeopleRelationshipsCacheReadResult<T> = { hit: true; data: T } | { hit: false }

interface VersionedPeopleRelationshipsCacheEntry<T> {
  v: string
  data: T
}

export function createEmptyPeopleRelationshipsFactsCacheStats(): PeopleRelationshipsFactsCacheStats {
  return {
    latestHits: 0,
    latestMisses: 0,
    factsHits: 0,
    factsMisses: 0,
    writes: 0,
  }
}

export function buildPeopleRelationshipsSessionLatestCacheKey(algorithmVersion: string): string {
  return `people-relationships:latest:v${PEOPLE_RELATIONSHIPS_FACTS_FORMAT_VERSION}:${algorithmVersion}`
}

export function buildPeopleRelationshipsSessionFactsCacheKey(
  algorithmVersion: string,
  timeRange: ContactsTimeRangeState
): string {
  return [
    'people-relationships:facts',
    `v${PEOPLE_RELATIONSHIPS_FACTS_FORMAT_VERSION}`,
    algorithmVersion,
    `preset:${timeRange.preset}`,
    `start:${timeRange.startTs ?? 'all'}`,
  ].join(':')
}

export function readCachedPeopleRelationshipsSessionLatest(
  sessionId: string,
  cacheDir: string,
  key: string,
  dbVersion: string
): PeopleRelationshipsCacheReadResult<PeopleRelationshipsSessionLatestFacts> {
  const cached = getCache<VersionedPeopleRelationshipsCacheEntry<PeopleRelationshipsSessionLatestFacts>>(
    sessionId,
    key,
    cacheDir
  )
  if (!cached || cached.v !== dbVersion || !isPeopleRelationshipsSessionLatestFacts(cached.data)) return { hit: false }
  return { hit: true, data: cached.data }
}

export function writeCachedPeopleRelationshipsSessionLatest(
  sessionId: string,
  cacheDir: string,
  key: string,
  dbVersion: string,
  data: PeopleRelationshipsSessionLatestFacts
): void {
  setCache<VersionedPeopleRelationshipsCacheEntry<PeopleRelationshipsSessionLatestFacts>>(
    sessionId,
    key,
    { v: dbVersion, data },
    cacheDir
  )
}

export function readCachedPeopleRelationshipsSessionFacts(
  sessionId: string,
  cacheDir: string,
  key: string,
  dbVersion: string
): PeopleRelationshipsCacheReadResult<PeopleRelationshipsSessionFacts> {
  const cached = getCache<VersionedPeopleRelationshipsCacheEntry<PeopleRelationshipsSessionFacts>>(
    sessionId,
    key,
    cacheDir
  )
  if (!cached || cached.v !== dbVersion || !isPeopleRelationshipsSessionFacts(cached.data)) return { hit: false }
  return { hit: true, data: cached.data }
}

export function writeCachedPeopleRelationshipsSessionFacts(
  sessionId: string,
  cacheDir: string,
  key: string,
  dbVersion: string,
  data: PeopleRelationshipsSessionFacts
): void {
  setCache<VersionedPeopleRelationshipsCacheEntry<PeopleRelationshipsSessionFacts>>(
    sessionId,
    key,
    { v: dbVersion, data },
    cacheDir
  )
}

export function deletePeopleRelationshipsSessionFactsCache(sessionId: string, cacheDir: string): void {
  deleteSessionCache(sessionId, cacheDir)
}

function isPeopleRelationshipsSessionLatestFacts(value: unknown): value is PeopleRelationshipsSessionLatestFacts {
  return isObject(value) && isNullableNumber(value.latestMessageTs)
}

function isPeopleRelationshipsSessionFacts(value: unknown): value is PeopleRelationshipsSessionFacts {
  if (!isObject(value) || typeof value.kind !== 'string' || !isNullableNumber(value.latestMessageTs)) return false
  switch (value.kind) {
    case 'not_chat_db':
    case 'missing_meta':
    case 'unsupported_type':
      return true
    case 'missing_owner':
    case 'unresolved_owner':
    case 'private_missing':
    case 'private_ambiguous':
      return isPeopleRelationshipsSessionMetaFacts(value.meta)
    case 'private':
      return isPeopleRelationshipsSessionMetaFacts(value.meta) && isPeopleRelationshipsCachedPrivateFacts(value.facts)
    case 'group':
      return isPeopleRelationshipsSessionMetaFacts(value.meta) && isPeopleRelationshipsCachedGroupFacts(value.facts)
    default:
      return false
  }
}

function isPeopleRelationshipsSessionMetaFacts(value: unknown): value is PeopleRelationshipsSessionMetaFacts {
  return (
    isObject(value) &&
    typeof value.name === 'string' &&
    typeof value.platform === 'string' &&
    (value.type === ChatType.PRIVATE || value.type === ChatType.GROUP) &&
    (typeof value.ownerId === 'string' || value.ownerId === null)
  )
}

function isPeopleRelationshipsCachedPrivateFacts(value: unknown): value is PeopleRelationshipsCachedPrivateFacts {
  return (
    isObject(value) &&
    isContactMemberRef(value.contact) &&
    isFiniteNumber(value.privateMessageCount) &&
    Array.isArray(value.activeMonths) &&
    value.activeMonths.every((month) => typeof month === 'string') &&
    isNullableNumber(value.lastMessageTs)
  )
}

function isPeopleRelationshipsCachedGroupFacts(value: unknown): value is PeopleRelationshipsCachedGroupFacts {
  return (
    isObject(value) &&
    Array.isArray(value.members) &&
    value.members.every(isRelationshipGraphMemberFact) &&
    Array.isArray(value.edges) &&
    value.edges.every(isRelationshipGraphEdgeFact)
  )
}

function isRelationshipGraphMemberFact(value: unknown): value is RelationshipGraphMemberFact {
  return (
    isObject(value) &&
    isContactMemberRef(value.contact) &&
    isFiniteNumber(value.messageCount) &&
    isNullableNumber(value.lastMessageTs)
  )
}

function isRelationshipGraphEdgeFact(value: unknown): value is RelationshipGraphEdgeFact {
  return (
    isObject(value) &&
    isContactMemberRef(value.source) &&
    isContactMemberRef(value.target) &&
    isFiniteNumber(value.coOccurrenceCount) &&
    isFiniteNumber(value.coOccurrenceRawScore) &&
    isFiniteNumber(value.replyInteractionCount) &&
    isFiniteNumber(value.repliesFromSourceToTarget) &&
    isFiniteNumber(value.repliesFromTargetToSource) &&
    isNullableNumber(value.lastInteractionTs)
  )
}

function isContactMemberRef(value: unknown): value is ContactMemberRef {
  return (
    isObject(value) &&
    isFiniteNumber(value.id) &&
    typeof value.platformId === 'string' &&
    typeof value.name === 'string' &&
    Array.isArray(value.aliases) &&
    value.aliases.every((alias) => typeof alias === 'string') &&
    (typeof value.avatar === 'string' || value.avatar === null)
  )
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
