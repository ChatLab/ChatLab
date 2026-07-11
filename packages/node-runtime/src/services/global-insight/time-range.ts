import type { AnnualSummaryRange } from '@openchatlab/shared-types'

export interface AnnualSummaryRangeInput {
  mode?: unknown
  year?: unknown
  days?: unknown
}

export function normalizeAnnualSummaryRange(
  input: AnnualSummaryRangeInput,
  nowInput: Date = new Date()
): AnnualSummaryRange {
  const now = new Date(nowInput)
  const nowTs = Math.floor(now.getTime() / 1000)
  if (input.mode === 'recent') {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() - 364)
    return {
      mode: 'recent',
      days: 365,
      startTs: Math.floor(start.getTime() / 1000),
      endTs: nowTs,
    }
  }

  const currentYear = now.getFullYear()
  const parsedYear = Number(input.year)
  const year =
    Number.isInteger(parsedYear) && parsedYear >= 1970 && parsedYear <= currentYear ? parsedYear : currentYear
  const start = new Date(year, 0, 1, 0, 0, 0)
  const end = year === currentYear ? now : new Date(year, 11, 31, 23, 59, 59)
  return {
    mode: 'year',
    year,
    startTs: Math.floor(start.getTime() / 1000),
    endTs: Math.floor(end.getTime() / 1000),
  }
}

export function getAnnualSummaryElapsedDayCount(range: AnnualSummaryRange): number {
  const start = new Date(range.startTs * 1000)
  const end = new Date(range.endTs * 1000)
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())
  const endDay = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate())
  return Math.max(Math.floor((endDay - startDay) / 86_400_000) + 1, 0)
}

export function toAnnualSummaryRangeKey(range: AnnualSummaryRange): string {
  return range.mode === 'year' ? `year-${range.year}` : 'recent-365'
}

export function toAnnualSummaryLocalDate(range: AnnualSummaryRange): string {
  const date = new Date(range.endTs * 1000)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}
