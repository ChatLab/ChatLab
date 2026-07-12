import type {
  AnnualSummaryCoverage,
  AnnualSummaryMetrics,
  AnnualSummaryRange,
  AnnualSummaryTextLength,
} from '@openchatlab/shared-types'

export const ANNUAL_SUMMARY_ALGORITHM_VERSION = 'annual-summary-v1'

export interface AnnualSummaryWorkerStats {
  durationMs: number
  totalSessions: number
  processedSessions: number
  cacheHits: number
  cacheMisses: number
}

export interface AnnualSummarySnapshot {
  algorithmVersion: string
  signature: string
  computedAt: number
  range: AnnualSummaryRange
  availableDataYears: number[]
  latestDataYear: number | null
  metrics: AnnualSummaryMetrics
  monthlyActivity: Array<{ month: string; messageCount: number }>
  dailyActivity: Array<{ date: string; messageCount: number }>
  messageTypes: Array<{ type: number; count: number }>
  textLength: AnnualSummaryTextLength
  coverage: AnnualSummaryCoverage
  workerStats: AnnualSummaryWorkerStats
}

export interface AnnualSummaryComputeProgress {
  processedSessions: number
  totalSessions: number
  currentSessionId?: string
}
