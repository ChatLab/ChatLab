import type { AnnualSummaryRange } from '@openchatlab/shared-types'
import { getDbFileVersion } from '../../cache/analytics-cache'
import type { SessionRuntimeAdapter } from '../adapters'
import { toAnnualSummaryLocalDate, toAnnualSummaryRangeKey } from './time-range'
import { TIME_INVESTMENT_ALGORITHM_VERSION } from './time-investment-types'
import { listOwnerInsightSessionIds } from './session-scope'

export function buildTimeInvestmentSignature(
  adapter: SessionRuntimeAdapter,
  range: AnnualSummaryRange,
  excludedSessionIds: readonly string[] = []
): string {
  const parts = [
    `algorithm:${TIME_INVESTMENT_ALGORITHM_VERSION}`,
    `range:${toAnnualSummaryRangeKey(range)}`,
    `start:${range.startTs}`,
    `day:${toAnnualSummaryLocalDate(range)}`,
  ]
  for (const sessionId of listOwnerInsightSessionIds(adapter, excludedSessionIds).sort()) {
    parts.push(`${sessionId}:${getDbFileVersion(adapter.getDbPath(sessionId))}`)
  }
  return parts.join('|')
}
