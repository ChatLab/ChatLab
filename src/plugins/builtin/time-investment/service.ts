import type { TimeInvestmentResponse } from '@openchatlab/shared-types'
import type { AnnualSummaryFetchOptions } from '@/services/data/types'
import type { Disposer } from '../../core'
import { createUiServiceKey } from '../../ui-host'

export interface TimeInvestmentUiService {
  readonly canConfigureOwner: boolean
  get(options: AnnualSummaryFetchOptions): Promise<TimeInvestmentResponse>
  recompute(options: AnnualSummaryFetchOptions): Promise<TimeInvestmentResponse>
  openOwnerSettings(): void
  subscribeOwnerSettingsClosed(listener: () => void): Disposer
}

export const TIME_INVESTMENT_UI_SERVICE = createUiServiceKey<TimeInvestmentUiService>(
  'insight.time-investment.ui-service'
)
