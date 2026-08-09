const DAY_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export interface TopicDayRange {
  dayKey: string
  startTs: number
  endTs: number
}

export function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(0)
  } catch {
    throw Object.assign(new Error(`Invalid timezone: ${timezone}`), { statusCode: 400 })
  }
}

export function assertValidTopicDayKey(dayKey: string): void {
  parseDayKey(dayKey)
}

export function formatTopicDayKey(timestampSeconds: number, timezone: string): string {
  assertValidTimezone(timezone)
  return getZonedDayKey(timestampSeconds * 1000, timezone)
}

export function getTopicDayRange(dayKey: string, timezone: string): TopicDayRange {
  assertValidTimezone(timezone)
  const start = parseDayKey(dayKey)
  const next = addCalendarDays(start, 1)
  return {
    dayKey,
    startTs: Math.floor(zonedMidnightToUtcMs(start, timezone) / 1000),
    endTs: Math.floor(zonedMidnightToUtcMs(next, timezone) / 1000),
  }
}

export function enumerateTopicDays(startDay: string, endDay: string): string[] {
  const start = parseDayKey(startDay)
  const end = parseDayKey(endDay)
  const startValue = Date.UTC(start.year, start.month - 1, start.day)
  const endValue = Date.UTC(end.year, end.month - 1, end.day)
  if (startValue > endValue) return []

  const days: string[] = []
  for (let cursor = start; ; cursor = addCalendarDays(cursor, 1)) {
    days.push(formatCalendarDay(cursor))
    if (Date.UTC(cursor.year, cursor.month - 1, cursor.day) === endValue) break
    if (days.length > 36_600) throw new Error('Topic day range is unexpectedly large')
  }
  return days
}

export function startOfTopicYear(dayKey: string): string {
  const day = parseDayKey(dayKey)
  return `${String(day.year).padStart(4, '0')}-01-01`
}

interface CalendarDay {
  year: number
  month: number
  day: number
}

function parseDayKey(dayKey: string): CalendarDay {
  const match = DAY_KEY_PATTERN.exec(dayKey)
  if (!match) throw Object.assign(new Error(`Invalid day key: ${dayKey}`), { statusCode: 400 })
  const result = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
  const date = new Date(Date.UTC(result.year, result.month - 1, result.day))
  if (
    date.getUTCFullYear() !== result.year ||
    date.getUTCMonth() + 1 !== result.month ||
    date.getUTCDate() !== result.day
  ) {
    throw Object.assign(new Error(`Invalid day key: ${dayKey}`), { statusCode: 400 })
  }
  return result
}

function addCalendarDays(day: CalendarDay, count: number): CalendarDay {
  const date = new Date(Date.UTC(day.year, day.month - 1, day.day + count))
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
}

function formatCalendarDay(day: CalendarDay): string {
  return [day.year, day.month, day.day].map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0')).join('-')
}

function zonedMidnightToUtcMs(day: CalendarDay, timezone: string): number {
  const desiredWallTime = Date.UTC(day.year, day.month - 1, day.day)
  let guess = desiredWallTime
  for (let index = 0; index < 4; index += 1) {
    const next = desiredWallTime - getTimezoneOffsetMs(guess, timezone)
    if (next === guess) break
    guess = next
  }

  const targetDayKey = formatCalendarDay(day)
  const candidate = getZonedDateTimeParts(guess, timezone)
  if (
    formatCalendarDay(candidate) === targetDayKey &&
    candidate.hour === 0 &&
    candidate.minute === 0 &&
    candidate.second === 0 &&
    getZonedDayKey(guess - 1_000, timezone) < targetDayKey
  ) {
    return guess
  }

  return findFirstInstantOfDay(desiredWallTime, targetDayKey, timezone)
}

function getTimezoneOffsetMs(timestampMs: number, timezone: string): number {
  const values = getZonedDateTimeParts(timestampMs, timezone)
  const wallTimeAsUtc = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second)
  return wallTimeAsUtc - Math.floor(timestampMs / 1000) * 1000
}

function findFirstInstantOfDay(desiredWallTime: number, targetDayKey: string, timezone: string): number {
  const searchWindowMs = 48 * 60 * 60 * 1000
  let lower = Math.floor((desiredWallTime - searchWindowMs) / 1000)
  let upper = Math.ceil((desiredWallTime + searchWindowMs) / 1000)

  while (lower + 1 < upper) {
    const middle = Math.floor((lower + upper) / 2)
    if (getZonedDayKey(middle * 1000, timezone) < targetDayKey) {
      lower = middle
    } else {
      upper = middle
    }
  }

  return upper * 1000
}

function getZonedDayKey(timestampMs: number, timezone: string): string {
  return formatCalendarDay(getZonedDateTimeParts(timestampMs, timezone))
}

interface ZonedDateTimeParts extends CalendarDay {
  hour: number
  minute: number
  second: number
}

function getZonedDateTimeParts(timestampMs: number, timezone: string): ZonedDateTimeParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestampMs))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  }
}
