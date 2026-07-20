import dayjs from 'dayjs'

export interface OverviewTimeRange {
  start: number
  end: number
}

export interface OverviewTimeFilter {
  startTs?: number
  endTs?: number
}

const SECONDS_PER_DAY = 86400

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function hasOverviewTimeFilter(timeFilter?: OverviewTimeFilter): boolean {
  return isFiniteNumber(timeFilter?.startTs) && isFiniteNumber(timeFilter?.endTs)
}

export function resolveOverviewTimeRange(
  fullTimeRange: OverviewTimeRange | null,
  timeFilter?: OverviewTimeFilter
): OverviewTimeRange | null {
  const start = timeFilter?.startTs ?? fullTimeRange?.start
  const end = timeFilter?.endTs ?? fullTimeRange?.end

  if (!isFiniteNumber(start) || !isFiniteNumber(end) || end < start) {
    return null
  }

  return { start, end }
}

export function getOverviewDurationDays(timeRange: OverviewTimeRange | null, minimumObservedDays = 0): number {
  if (!timeRange || timeRange.end < timeRange.start) return 0
  return Math.max(Math.ceil((timeRange.end - timeRange.start) / SECONDS_PER_DAY), minimumObservedDays, 1)
}

export function getOverviewCalendarRange(timeRange: OverviewTimeRange | null): [string, string] | null {
  if (!timeRange) return null
  return [dayjs.unix(timeRange.start).format('YYYY-MM-DD'), dayjs.unix(timeRange.end).format('YYYY-MM-DD')]
}
