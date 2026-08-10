import type { TimeInvestmentSessionFacts } from '@openchatlab/core'
import type { AnnualSummaryRange } from '@openchatlab/shared-types'
import { getCache, setCache } from '../../cache/session-cache'
import { toAnnualSummaryRangeKey } from './time-range'

const FACTS_FORMAT_VERSION = 1

interface CachedFactsEntry {
  v: string
  rangeIdentity: string
  data: TimeInvestmentSessionFacts
}

export type TimeInvestmentFactsCacheReadResult = { hit: true; data: TimeInvestmentSessionFacts } | { hit: false }

export function buildTimeInvestmentFactsCacheKey(algorithmVersion: string, range: AnnualSummaryRange): string {
  return `global-insight:time-investment:facts:v${FACTS_FORMAT_VERSION}:${algorithmVersion}:${toAnnualSummaryRangeKey(range)}`
}

export function readCachedTimeInvestmentSessionFacts(
  sessionId: string,
  cacheDir: string,
  key: string,
  dbVersion: string,
  range: AnnualSummaryRange
): TimeInvestmentFactsCacheReadResult {
  const cached = getCache<CachedFactsEntry>(sessionId, key, cacheDir)
  if (
    !cached ||
    cached.v !== dbVersion ||
    cached.rangeIdentity !== buildRangeIdentity(range) ||
    !isTimeInvestmentSessionFacts(cached.data)
  ) {
    return { hit: false }
  }
  return { hit: true, data: cached.data }
}

export function writeCachedTimeInvestmentSessionFacts(
  sessionId: string,
  cacheDir: string,
  key: string,
  dbVersion: string,
  range: AnnualSummaryRange,
  data: TimeInvestmentSessionFacts
): void {
  setCache<CachedFactsEntry>(sessionId, key, { v: dbVersion, rangeIdentity: buildRangeIdentity(range), data }, cacheDir)
}

function buildRangeIdentity(range: AnnualSummaryRange): string {
  return `${toAnnualSummaryRangeKey(range)}:${range.startTs}:${range.endTs}`
}

function isTimeInvestmentSessionFacts(value: unknown): value is TimeInvestmentSessionFacts {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (typeof record.kind !== 'string' || !Array.isArray(record.availableDataYears)) return false
  if (record.kind !== 'analyzed') return true
  return (
    typeof record.sessionId === 'string' &&
    typeof record.sessionName === 'string' &&
    typeof record.platform === 'string' &&
    typeof record.chatType === 'string' &&
    isIntervals(record.investmentIntervals)
  )
}

function isIntervals(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item !== null &&
        typeof item === 'object' &&
        typeof (item as Record<string, unknown>).startTs === 'number' &&
        typeof (item as Record<string, unknown>).endTs === 'number'
    )
  )
}
