import type {
  AnnualSummaryCoverage,
  AnnualSummaryRange,
  TimeInvestmentActivityPoint,
  TimeInvestmentChatTypeItem,
  TimeInvestmentMetrics,
  TimeInvestmentSessionRankItem,
} from '@openchatlab/shared-types'
import type { AnnualSummaryWorkerStats } from './types'

export const TIME_INVESTMENT_ALGORITHM_VERSION = 'time-investment-v2'

export interface TimeInvestmentSnapshot {
  algorithmVersion: string
  signature: string
  computedAt: number
  range: AnnualSummaryRange
  availableDataYears: number[]
  latestDataYear: number | null
  metrics: TimeInvestmentMetrics
  monthlyActivity: TimeInvestmentActivityPoint[]
  dailyActivity: TimeInvestmentActivityPoint[]
  sessionRanking: TimeInvestmentSessionRankItem[]
  chatTypes: TimeInvestmentChatTypeItem[]
  coverage: AnnualSummaryCoverage
  workerStats: AnnualSummaryWorkerStats
}
