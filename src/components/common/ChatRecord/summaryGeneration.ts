import type { SummaryStrategy } from '@/composables/useUiConfig'

export interface MutableBooleanRef {
  value: boolean
}

export function stopBatchSummaryGeneration(shouldStop: MutableBooleanRef): void {
  shouldStop.value = true
}

export function buildGenerateSummaryArgs(
  dbSessionId: string,
  segmentId: number,
  locale: string,
  strategy: SummaryStrategy
): [string, number, string, false, SummaryStrategy] {
  return [dbSessionId, segmentId, locale, false, strategy]
}
