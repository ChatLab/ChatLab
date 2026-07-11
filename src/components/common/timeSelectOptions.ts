export type SupportedTimeSelectMode = 'recent' | 'quarter' | 'year' | 'custom'

const ALL_MODES: SupportedTimeSelectMode[] = ['recent', 'quarter', 'year', 'custom']
const ALL_RECENT_DAYS = [365, 730, 1825, 0]

export function normalizeAllowedModes(input?: readonly SupportedTimeSelectMode[]): SupportedTimeSelectMode[] {
  if (!input) return [...ALL_MODES]
  const requested = new Set(input)
  const result = ALL_MODES.filter((mode) => requested.has(mode))
  return result.length > 0 ? result : [...ALL_MODES]
}

export function normalizeAllowedRecentDays(input?: readonly number[]): number[] {
  if (!input) return [...ALL_RECENT_DAYS]
  const requested = new Set(input)
  const result = ALL_RECENT_DAYS.filter((days) => requested.has(days))
  return result.length > 0 ? result : [365]
}

export function buildTimeSelectSourceKey(
  sessionId: string | undefined,
  rangeSource?: {
    availableYears: readonly number[]
    fullRange: { start: number; end: number } | null
  }
): string {
  return [
    sessionId ?? '',
    rangeSource?.availableYears.join(',') ?? '',
    rangeSource?.fullRange?.start ?? '',
    rangeSource?.fullRange?.end ?? '',
  ].join('|')
}
