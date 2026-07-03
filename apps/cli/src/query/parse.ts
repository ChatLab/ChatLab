/**
 * Argument parsing infrastructure for agent-facing query commands.
 *
 * Time values (design §5.1): ISO dates plus the closed keyword set
 * `today` / `yesterday`, and `--last <N>h|d|w`. Date-only values span the
 * whole day (`--until 2026-06-30` includes the full day). Resolved absolute
 * times are echoed in meta.timeRange so agents can self-verify boundaries.
 */

import { createHash } from 'node:crypto'
import { QueryError } from './envelope'

export interface TimeCliOptions {
  since?: string
  until?: string
  last?: string
}

export interface ResolvedTimeRange {
  startTs?: number
  endTs?: number
  /** Echo of resolved absolute boundaries for meta.timeRange. */
  meta: { since: string | null; until: string | null }
}

/** Format a Date as ISO 8601 with the local UTC offset (sortable, self-describing). */
export function toIsoWithOffset(date: Date): string {
  const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, '0')
  const offsetMin = -date.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const offH = pad(Math.floor(Math.abs(offsetMin) / 60))
  const offM = pad(Math.abs(offsetMin) % 60)
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${offH}:${offM}`
  )
}

/** Convert epoch seconds to ISO string with local offset. */
export function epochToIso(ts: number): string {
  return toIsoWithOffset(new Date(ts * 1000))
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/
const LAST_DURATION = /^(\d+)([hdw])$/

function startOfDay(base: Date, dayOffset = 0): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset)
}

function invalidTime(flag: string, value: string): QueryError {
  return new QueryError({
    code: 'INVALID_ARGUMENT',
    message: `Invalid ${flag} value: ${value}`,
    hint: 'Use YYYY-MM-DD, "YYYY-MM-DD HH:mm", ISO 8601, or the keywords today/yesterday',
  })
}

/**
 * Parse a single time value. Date-only values resolve to the start of the day;
 * when `boundary` is 'end' they resolve to the end of the day (inclusive whole-day).
 */
function parseTimeValue(value: string, boundary: 'start' | 'end', flag: string, now: Date): Date {
  if (value === 'today' || value === 'yesterday') {
    const dayOffset = value === 'yesterday' ? -1 : 0
    if (boundary === 'start') return startOfDay(now, dayOffset)
    return new Date(startOfDay(now, dayOffset + 1).getTime() - 1000)
  }

  const dateOnly = DATE_ONLY.exec(value)
  if (dateOnly) {
    const [, y, m, d] = dateOnly
    const base = new Date(Number(y), Number(m) - 1, Number(d))
    if (Number.isNaN(base.getTime())) throw invalidTime(flag, value)
    if (boundary === 'start') return base
    return new Date(new Date(Number(y), Number(m) - 1, Number(d) + 1).getTime() - 1000)
  }

  const dateTime = DATE_TIME.exec(value)
  if (dateTime) {
    const [, y, m, d, h, min, s] = dateTime
    const parsed = new Date(Number(y), Number(m) - 1, Number(d), Number(h), Number(min), Number(s ?? 0))
    if (Number.isNaN(parsed.getTime())) throw invalidTime(flag, value)
    return parsed
  }

  // full ISO 8601 (with timezone offset or Z)
  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime()) && /\d{4}-\d{2}-\d{2}T/.test(value)) {
    return parsed
  }

  throw invalidTime(flag, value)
}

/** Resolve --since/--until/--last into epoch-second bounds plus a meta echo. */
export function parseTimeOptions(options: TimeCliOptions, now = new Date()): ResolvedTimeRange {
  const { since, until, last } = options

  if (last !== undefined && (since !== undefined || until !== undefined)) {
    throw new QueryError({
      code: 'INVALID_ARGUMENT',
      message: '--last cannot be combined with --since/--until',
      hint: 'Use either --last <N>h|d|w or explicit --since/--until bounds',
    })
  }

  if (last !== undefined) {
    const match = LAST_DURATION.exec(last)
    if (!match) {
      throw new QueryError({
        code: 'INVALID_ARGUMENT',
        message: `Invalid --last value: ${last}`,
        hint: 'Supported units: h (hours), d (days), w (weeks), e.g. --last 30d',
      })
    }
    const n = Number(match[1])
    const unitSeconds = match[2] === 'h' ? 3600 : match[2] === 'd' ? 86400 : 604800
    const start = new Date(now.getTime() - n * unitSeconds * 1000)
    return {
      startTs: Math.floor(start.getTime() / 1000),
      meta: { since: toIsoWithOffset(start), until: toIsoWithOffset(now) },
    }
  }

  let startTs: number | undefined
  let endTs: number | undefined
  let sinceIso: string | null = null

  if (since !== undefined) {
    const parsed = parseTimeValue(since, 'start', '--since', now)
    startTs = Math.floor(parsed.getTime() / 1000)
    sinceIso = toIsoWithOffset(parsed)
  }
  if (until !== undefined) {
    const parsed = parseTimeValue(until, 'end', '--until', now)
    endTs = Math.floor(parsed.getTime() / 1000)
  }

  if (startTs !== undefined && endTs !== undefined && startTs > endTs) {
    throw new QueryError({
      code: 'INVALID_ARGUMENT',
      message: '--since is after --until',
      hint: 'Check the time range boundaries',
    })
  }

  return {
    startTs,
    endTs,
    meta: {
      since: sinceIso,
      until: endTs !== undefined ? epochToIso(endTs) : toIsoWithOffset(now),
    },
  }
}

/** Parse a positive integer flag, clamped to a hard cap. */
export function parseLimit(
  value: string | number | undefined,
  defaultValue: number,
  cap: number,
  flag: string
): number {
  if (value === undefined) return Math.min(defaultValue, cap)
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(n) || n < 0) {
    throw new QueryError({
      code: 'INVALID_ARGUMENT',
      message: `Invalid ${flag} value: ${value}`,
      hint: `${flag} must be a non-negative integer (max ${cap})`,
    })
  }
  return Math.min(n, cap)
}

// ==================== Cursor ====================

/** Stable fingerprint of query conditions; cursors from a different query are rejected. */
export function queryFingerprint(conditions: Record<string, unknown>): string {
  const canonical = JSON.stringify(conditions, Object.keys(conditions).sort())
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12)
}

export function encodeCursor(offset: number, fingerprint: string): string {
  return Buffer.from(`${fingerprint}:${offset}`, 'utf8').toString('base64url')
}

/** Decode a cursor and validate it against the current query fingerprint. */
export function decodeCursor(token: string, fingerprint: string): number {
  let decoded = ''
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8')
  } catch {
    // fall through to the shared error below
  }
  const match = /^([0-9a-f]{12}):(\d+)$/.exec(decoded)
  if (!match || match[1] !== fingerprint) {
    throw new QueryError({
      code: 'CURSOR_INVALID',
      message: 'Cursor does not match the current query conditions',
      hint: 'Cursors are only valid for the exact query that produced them; re-run the query without --cursor',
    })
  }
  return Number(match[2])
}
