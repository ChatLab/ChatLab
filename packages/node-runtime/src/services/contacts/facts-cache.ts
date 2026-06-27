import { ChatType, type ChatPlatform, type ContactsTimeRangeState } from '@openchatlab/shared-types'
import type { ContactMemberRef } from '@openchatlab/core'
import { getCache, setCache, deleteSessionCache } from '../../cache/session-cache'

export const CONTACTS_FACTS_FORMAT_VERSION = 1

export interface ContactsFactsCacheStats {
  latestHits: number
  latestMisses: number
  factsHits: number
  factsMisses: number
  writes: number
}

export interface ContactsSessionMetaFacts {
  name: string
  platform: ChatPlatform
  type: ChatType.PRIVATE | ChatType.GROUP
  ownerId: string | null
}

export interface ContactsCachedPrivateFacts {
  contact: ContactMemberRef
  privateMessageCount: number
  activeMonths: string[]
  lastMessageTs: number | null
}

export interface ContactsCachedGroupFacts {
  contact: ContactMemberRef
  messageCount: number
  coOccurrenceCount: number
  coOccurrenceRawScore: number
  replyInteractionCount: number
  repliesFromOwnerToContact: number
  repliesFromContactToOwner: number
  lastInteractionTs: number | null
}

export type ContactsSessionFacts =
  | { kind: 'not_chat_db'; latestMessageTs: null }
  | { kind: 'missing_meta'; latestMessageTs: number | null }
  | { kind: 'unsupported_type'; latestMessageTs: number | null }
  | { kind: 'missing_owner'; meta: ContactsSessionMetaFacts; latestMessageTs: number | null }
  | { kind: 'unresolved_owner'; meta: ContactsSessionMetaFacts; latestMessageTs: number | null }
  | { kind: 'private_missing'; meta: ContactsSessionMetaFacts; latestMessageTs: number | null }
  | { kind: 'private_ambiguous'; meta: ContactsSessionMetaFacts; latestMessageTs: number | null }
  | {
      kind: 'private'
      meta: ContactsSessionMetaFacts
      latestMessageTs: number | null
      facts: ContactsCachedPrivateFacts
    }
  | {
      kind: 'group'
      meta: ContactsSessionMetaFacts
      latestMessageTs: number | null
      facts: ContactsCachedGroupFacts[]
    }

export interface ContactsSessionLatestFacts {
  latestMessageTs: number | null
}

export type ContactsCacheReadResult<T> = { hit: true; data: T } | { hit: false }

interface VersionedContactsCacheEntry<T> {
  v: string
  data: T
}

export function createEmptyContactsFactsCacheStats(): ContactsFactsCacheStats {
  return {
    latestHits: 0,
    latestMisses: 0,
    factsHits: 0,
    factsMisses: 0,
    writes: 0,
  }
}

export function buildContactsSessionLatestCacheKey(algorithmVersion: string): string {
  return `contacts:latest:v${CONTACTS_FACTS_FORMAT_VERSION}:${algorithmVersion}`
}

export function buildContactsSessionFactsCacheKey(algorithmVersion: string, timeRange: ContactsTimeRangeState): string {
  return [
    'contacts:facts',
    `v${CONTACTS_FACTS_FORMAT_VERSION}`,
    algorithmVersion,
    `preset:${timeRange.preset}`,
    `start:${timeRange.startTs ?? 'all'}`,
  ].join(':')
}

export function readCachedContactsSessionLatest(
  sessionId: string,
  cacheDir: string,
  key: string,
  dbVersion: string
): ContactsCacheReadResult<ContactsSessionLatestFacts> {
  const cached = getCache<VersionedContactsCacheEntry<ContactsSessionLatestFacts>>(sessionId, key, cacheDir)
  if (!cached || cached.v !== dbVersion || !isContactsSessionLatestFacts(cached.data)) return { hit: false }
  return { hit: true, data: cached.data }
}

export function writeCachedContactsSessionLatest(
  sessionId: string,
  cacheDir: string,
  key: string,
  dbVersion: string,
  data: ContactsSessionLatestFacts
): void {
  setCache<VersionedContactsCacheEntry<ContactsSessionLatestFacts>>(sessionId, key, { v: dbVersion, data }, cacheDir)
}

export function readCachedContactsSessionFacts(
  sessionId: string,
  cacheDir: string,
  key: string,
  dbVersion: string
): ContactsCacheReadResult<ContactsSessionFacts> {
  const cached = getCache<VersionedContactsCacheEntry<ContactsSessionFacts>>(sessionId, key, cacheDir)
  if (!cached || cached.v !== dbVersion || !isContactsSessionFacts(cached.data)) return { hit: false }
  return { hit: true, data: cached.data }
}

export function writeCachedContactsSessionFacts(
  sessionId: string,
  cacheDir: string,
  key: string,
  dbVersion: string,
  data: ContactsSessionFacts
): void {
  setCache<VersionedContactsCacheEntry<ContactsSessionFacts>>(sessionId, key, { v: dbVersion, data }, cacheDir)
}

export function deleteContactsSessionFactsCache(sessionId: string, cacheDir: string): void {
  deleteSessionCache(sessionId, cacheDir)
}

function isContactsSessionLatestFacts(value: unknown): value is ContactsSessionLatestFacts {
  return isObject(value) && isNullableNumber(value.latestMessageTs)
}

function isContactsSessionFacts(value: unknown): value is ContactsSessionFacts {
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
      return isContactsSessionMetaFacts(value.meta)
    case 'private':
      return isContactsSessionMetaFacts(value.meta) && isContactsCachedPrivateFacts(value.facts)
    case 'group':
      return (
        isContactsSessionMetaFacts(value.meta) &&
        Array.isArray(value.facts) &&
        value.facts.every(isContactsCachedGroupFacts)
      )
    default:
      return false
  }
}

function isContactsSessionMetaFacts(value: unknown): value is ContactsSessionMetaFacts {
  return (
    isObject(value) &&
    typeof value.name === 'string' &&
    typeof value.platform === 'string' &&
    (value.type === ChatType.PRIVATE || value.type === ChatType.GROUP) &&
    (typeof value.ownerId === 'string' || value.ownerId === null)
  )
}

function isContactsCachedPrivateFacts(value: unknown): value is ContactsCachedPrivateFacts {
  return (
    isObject(value) &&
    isContactMemberRef(value.contact) &&
    isFiniteNumber(value.privateMessageCount) &&
    Array.isArray(value.activeMonths) &&
    value.activeMonths.every((month) => typeof month === 'string') &&
    isNullableNumber(value.lastMessageTs)
  )
}

function isContactsCachedGroupFacts(value: unknown): value is ContactsCachedGroupFacts {
  return (
    isObject(value) &&
    isContactMemberRef(value.contact) &&
    isFiniteNumber(value.messageCount) &&
    isFiniteNumber(value.coOccurrenceCount) &&
    isFiniteNumber(value.coOccurrenceRawScore) &&
    isFiniteNumber(value.replyInteractionCount) &&
    isFiniteNumber(value.repliesFromOwnerToContact) &&
    isFiniteNumber(value.repliesFromContactToOwner) &&
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
