import {
  aggregateTimeInvestmentFacts,
  getTimeInvestmentSessionFacts,
  type TimeInvestmentSessionFacts,
} from '@openchatlab/core'
import type { AnnualSummaryRange } from '@openchatlab/shared-types'
import { getDbFileVersion } from '../../cache/analytics-cache'
import { appLogger } from '../../logging/app-logger'
import type { SessionRuntimeAdapter } from '../adapters'
import {
  buildTimeInvestmentFactsCacheKey,
  readCachedTimeInvestmentSessionFacts,
  writeCachedTimeInvestmentSessionFacts,
} from './time-investment-facts-cache'
import { TIME_INVESTMENT_ALGORITHM_VERSION, type TimeInvestmentSnapshot } from './time-investment-types'
import type { AnnualSummaryComputeProgress } from './types'

export interface ComputeTimeInvestmentSnapshotOptions {
  adapter: SessionRuntimeAdapter
  signature: string
  range: AnnualSummaryRange
  factsCacheDir: string
  onProgress?: (progress: AnnualSummaryComputeProgress) => void
  now?: () => number
}

export function computeTimeInvestmentSnapshot(options: ComputeTimeInvestmentSnapshotOptions): TimeInvestmentSnapshot {
  const startedAt = options.now?.() ?? Date.now()
  const sessionIds = options.adapter.listSessionIds()
  const facts: TimeInvestmentSessionFacts[] = []
  let cacheHits = 0
  let cacheMisses = 0
  const cacheKey = buildTimeInvestmentFactsCacheKey(TIME_INVESTMENT_ALGORITHM_VERSION, options.range)

  appLogger.info('global-insight', 'time investment compute started', {
    mode: options.range.mode,
    year: options.range.year,
    totalSessions: sessionIds.length,
  })

  for (const [index, sessionId] of sessionIds.entries()) {
    options.onProgress?.({ processedSessions: index, totalSessions: sessionIds.length, currentSessionId: sessionId })
    const dbPath = options.adapter.getDbPath(sessionId)
    const dbVersion = getDbFileVersion(dbPath)
    const cached = readCachedTimeInvestmentSessionFacts(
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
      const sessionFacts = getTimeInvestmentSessionFacts(db, sessionId, options.range)
      facts.push(sessionFacts)
      if (dbVersion === getDbFileVersion(dbPath)) {
        writeCachedTimeInvestmentSessionFacts(
          sessionId,
          options.factsCacheDir,
          cacheKey,
          dbVersion,
          options.range,
          sessionFacts
        )
      } else {
        appLogger.debug('global-insight', 'skipped time investment facts cache write because DB changed')
      }
    } catch (error) {
      facts.push({ kind: 'failed', availableDataYears: [] })
      appLogger.error('global-insight', 'failed to process time investment session', error)
    }
  }

  options.onProgress?.({ processedSessions: sessionIds.length, totalSessions: sessionIds.length })
  const aggregated = aggregateTimeInvestmentFacts(facts, options.range)
  const finishedAt = options.now?.() ?? Date.now()
  const snapshot: TimeInvestmentSnapshot = {
    algorithmVersion: TIME_INVESTMENT_ALGORITHM_VERSION,
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
  appLogger.info('global-insight', 'time investment compute completed', {
    totalSessions: sessionIds.length,
    analyzedSessions: snapshot.coverage.analyzedSessions,
    cacheHits,
    cacheMisses,
    durationMs: snapshot.workerStats.durationMs,
  })
  return snapshot
}
