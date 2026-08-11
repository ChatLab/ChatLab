import type { AnnualSummaryResponse } from '@openchatlab/shared-types'
import type { AnnualSummaryFetchOptions } from '@/services/data/types'
import type { Disposer } from '../../core'
import { createUiServiceKey } from '../../ui-host'

export interface AnnualSummaryUiService {
  get(options: AnnualSummaryFetchOptions): Promise<AnnualSummaryResponse>
  recompute(options: AnnualSummaryFetchOptions): Promise<AnnualSummaryResponse>
  openOwnerSettings(): void
  subscribeOwnerSettingsClosed(listener: () => void): Disposer
}

export const ANNUAL_SUMMARY_UI_SERVICE = createUiServiceKey<AnnualSummaryUiService>('insight.annual-summary.ui-service')
