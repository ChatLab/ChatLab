import {
  aggregateAnnualSummaryFacts,
  getAnnualSummarySessionFacts,
  type AnnualSummarySessionFacts,
} from '@openchatlab/core'
import type { AnnualSummaryRange } from '@openchatlab/shared-types'
import { getDbFileVersion } from '../../cache/analytics-cache'
import { appLogger } from '../../logging/app-logger'
import type { SessionRuntimeAdapter } from '../adapters'
import {
  buildAnnualSummaryFactsCacheKey,
  readCachedAnnualSummarySessionFacts,
  writeCachedAnnualSummarySessionFacts,
} from './facts-cache'
import { getAnnualSummaryElapsedDayCount } from './time-range'
import {
  ANNUAL_SUMMARY_ALGORITHM_VERSION,
  type AnnualSummaryComputeProgress,
  type AnnualSummarySnapshot,
} from './types'

export interface ComputeAnnualSummarySnapshotOptions {
  adapter: SessionRuntimeAdapter
  signature: string
  range: AnnualSummaryRange
  factsCacheDir: string
  onProgress?: (progress: AnnualSummaryComputeProgress) => void
  now?: () => number
}

export function computeAnnualSummarySnapshot(options: ComputeAnnualSummarySnapshotOptions): AnnualSummarySnapshot {
  const startedAt = options.now?.() ?? Date.now()
  const sessionIds = options.adapter.listSessionIds()
  const facts: AnnualSummarySessionFacts[] = []
  let cacheHits = 0
  let cacheMisses = 0
  const cacheKey = buildAnnualSummaryFactsCacheKey(ANNUAL_SUMMARY_ALGORITHM_VERSION, options.range)

  appLogger.info('global-insight', 'annual summary compute started', {
    mode: options.range.mode,
    year: options.range.year,
    totalSessions: sessionIds.length,
  })

  for (const [index, sessionId] of sessionIds.entries()) {
    options.onProgress?.({
      processedSessions: index,
      totalSessions: sessionIds.length,
      currentSessionId: sessionId,
    })
    const dbVersion = getDbFileVersion(options.adapter.getDbPath(sessionId))
    const cached = readCachedAnnualSummarySessionFacts(
      sessionId,
      options.factsCacheDir,
      cacheKey,
      dbVersion,
      options.range
    )
    if (cached.hit) {
      cacheHits++
      facts.push(cached.data)
      continue
    }

    cacheMisses++
    try {
      const db = options.adapter.openReadonly(sessionId)
      if (!db) {
        facts.push({ kind: 'failed', availableDataYears: [] })
        continue
      }
      const sessionFacts = getAnnualSummarySessionFacts(db, sessionId, options.range)
      facts.push(sessionFacts)
      if (dbVersion === getDbFileVersion(options.adapter.getDbPath(sessionId))) {
        writeCachedAnnualSummarySessionFacts(
          sessionId,
          options.factsCacheDir,
          cacheKey,
          dbVersion,
          options.range,
          sessionFacts
        )
      } else {
        appLogger.debug('global-insight', 'skipped annual summary facts cache write because DB changed')
      }
    } catch (error) {
      facts.push({ kind: 'failed', availableDataYears: [] })
      appLogger.error('global-insight', 'failed to process annual summary session', error)
    }
  }

  options.onProgress?.({ processedSessions: sessionIds.length, totalSessions: sessionIds.length })
  const aggregated = aggregateAnnualSummaryFacts(facts, options.range, getAnnualSummaryElapsedDayCount(options.range))
  const finishedAt = options.now?.() ?? Date.now()
  const snapshot: AnnualSummarySnapshot = {
    algorithmVersion: ANNUAL_SUMMARY_ALGORITHM_VERSION,
    signature: options.signature,
    computedAt: finishedAt,
    range: options.range,
    ...aggregated,
    workerStats: {
      durationMs: Math.max(0, finishedAt - startedAt),
      totalSessions: sessionIds.length,
      processedSessions: sessionIds.length,
      cacheHits,
      cacheMisses,
    },
  }
  appLogger.info('global-insight', 'annual summary compute completed', {
    totalSessions: sessionIds.length,
    analyzedSessions: snapshot.coverage.analyzedSessions,
    cacheHits,
    cacheMisses,
    durationMs: snapshot.workerStats.durationMs,
  })
  return snapshot
}
