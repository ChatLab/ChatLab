import type { AnnualSummarySessionFacts } from '@openchatlab/core'
import type { AnnualSummaryRange } from '@openchatlab/shared-types'
import { getCache, setCache } from '../../cache/session-cache'
import { toAnnualSummaryRangeKey } from './time-range'

const FACTS_FORMAT_VERSION = 1

interface CachedFactsEntry {
  v: string
  rangeIdentity: string
  data: AnnualSummarySessionFacts
}

export type AnnualSummaryFactsCacheReadResult = { hit: true; data: AnnualSummarySessionFacts } | { hit: false }

export function buildAnnualSummaryFactsCacheKey(algorithmVersion: string, range: AnnualSummaryRange): string {
  return `global-insight:facts:v${FACTS_FORMAT_VERSION}:${algorithmVersion}:${toAnnualSummaryRangeKey(range)}`
}

export function readCachedAnnualSummarySessionFacts(
  sessionId: string,
  cacheDir: string,
  key: string,
  dbVersion: string,
  range: AnnualSummaryRange
): AnnualSummaryFactsCacheReadResult {
  const cached = getCache<CachedFactsEntry>(sessionId, key, cacheDir)
  if (
    !cached ||
    cached.v !== dbVersion ||
    cached.rangeIdentity !== buildFactsRangeIdentity(range) ||
    !isAnnualSummarySessionFacts(cached.data)
  ) {
    return { hit: false }
  }
  return { hit: true, data: cached.data }
}

export function writeCachedAnnualSummarySessionFacts(
  sessionId: string,
  cacheDir: string,
  key: string,
  dbVersion: string,
  range: AnnualSummaryRange,
  data: AnnualSummarySessionFacts
): void {
  setCache<CachedFactsEntry>(
    sessionId,
    key,
    { v: dbVersion, rangeIdentity: buildFactsRangeIdentity(range), data },
    cacheDir
  )
}

function buildFactsRangeIdentity(range: AnnualSummaryRange): string {
  if (range.mode === 'year') return `year:${range.year}`
  return `recent:${toLocalDate(range.startTs)}:${toLocalDate(range.endTs)}`
}

function toLocalDate(ts: number): string {
  const date = new Date(ts * 1000)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

function isAnnualSummarySessionFacts(value: unknown): value is AnnualSummarySessionFacts {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (typeof record.kind !== 'string' || !Array.isArray(record.availableDataYears)) return false
  if (record.kind !== 'analyzed') return true
  return (
    isRecord(record.ownerMessagesByDay) &&
    isRecord(record.directContactKeysByDay) &&
    isRecord(record.messageTypeCounts) &&
    isRecord(record.textLengthCounts)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
