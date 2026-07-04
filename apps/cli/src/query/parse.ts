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

export interface CursorSnapshot {
  time?: ResolvedTimeRange
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
const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})T/
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

function isSameLocalDate(date: Date, y: number, m: number, d: number): boolean {
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}

function isSameLocalDateTime(date: Date, y: number, m: number, d: number, h: number, min: number, s: number): boolean {
  return isSameLocalDate(date, y, m, d) && date.getHours() === h && date.getMinutes() === min && date.getSeconds() === s
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
    const year = Number(y)
    const month = Number(m)
    const day = Number(d)
    const base = new Date(year, month - 1, day)
    if (Number.isNaN(base.getTime()) || !isSameLocalDate(base, year, month, day)) throw invalidTime(flag, value)
    if (boundary === 'start') return base
    return new Date(new Date(year, month - 1, day + 1).getTime() - 1000)
  }

  const dateTime = DATE_TIME.exec(value)
  if (dateTime) {
    const [, y, m, d, h, min, s] = dateTime
    const year = Number(y)
    const month = Number(m)
    const day = Number(d)
    const hour = Number(h)
    const minute = Number(min)
    const second = Number(s ?? 0)
    const parsed = new Date(year, month - 1, day, hour, minute, second)
    if (Number.isNaN(parsed.getTime()) || !isSameLocalDateTime(parsed, year, month, day, hour, minute, second)) {
      throw invalidTime(flag, value)
    }
    return parsed
  }

  // full ISO 8601 (with timezone offset or Z)
  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime()) && /\d{4}-\d{2}-\d{2}T/.test(value)) {
    const isoDate = ISO_DATE_PREFIX.exec(value)
    if (isoDate) {
      const [, y, m, d] = isoDate
      const year = Number(y)
      const month = Number(m)
      const day = Number(d)
      const localDate = new Date(year, month - 1, day)
      if (!isSameLocalDate(localDate, year, month, day)) throw invalidTime(flag, value)
    }
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
  flag: string,
  min = 0
): number {
  if (value === undefined) return Math.min(defaultValue, cap)
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(n) || n < min) {
    throw new QueryError({
      code: 'INVALID_ARGUMENT',
      message: `Invalid ${flag} value: ${value}`,
      hint:
        min > 0
          ? `${flag} must be an integer from ${min} to ${cap}`
          : `${flag} must be a non-negative integer (max ${cap})`,
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

export function freezeTimeRangeForCursor(time: ResolvedTimeRange): ResolvedTimeRange {
  if (time.endTs !== undefined || time.meta.until === null) return time
  const endMs = new Date(time.meta.until).getTime()
  if (Number.isNaN(endMs)) return time
  return { ...time, endTs: Math.floor(endMs / 1000) }
}

export function resolveTimeOptionsForCursor(
  options: TimeCliOptions & { cursor?: string },
  now = new Date()
): ResolvedTimeRange {
  const snapshot = options.cursor ? getCursorSnapshot(options.cursor) : undefined
  return snapshot?.time ?? freezeTimeRangeForCursor(parseTimeOptions(options, now))
}

export function encodeCursor(offset: number, fingerprint: string, snapshot?: CursorSnapshot): string {
  if (snapshot?.time) {
    return Buffer.from(JSON.stringify({ v: 2, fp: fingerprint, offset, time: snapshot.time }), 'utf8').toString(
      'base64url'
    )
  }
  return Buffer.from(`${fingerprint}:${offset}`, 'utf8').toString('base64url')
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function decodeCursorEnvelope(
  token: string
): { fingerprint: string; offset: number; snapshot?: CursorSnapshot } | null {
  let decoded = ''
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8')
  } catch {
    return null
  }

  let payload: unknown
  try {
    payload = JSON.parse(decoded)
  } catch {
    return null
  }

  const object = asObject(payload)
  if (
    !object ||
    object.v !== 2 ||
    typeof object.fp !== 'string' ||
    typeof object.offset !== 'number' ||
    !Number.isInteger(object.offset) ||
    object.offset < 0
  ) {
    return null
  }

  const snapshot = decodeCursorSnapshot(object)
  return { fingerprint: object.fp, offset: object.offset, ...(snapshot ? { snapshot } : {}) }
}

function decodeCursorSnapshot(payload: Record<string, unknown>): CursorSnapshot | undefined {
  const timeObject = asObject(payload.time)
  if (!timeObject) return undefined
  const metaObject = asObject(timeObject.meta)
  if (!metaObject) return undefined

  const startTs = timeObject.startTs
  const endTs = timeObject.endTs
  const since = metaObject.since
  const until = metaObject.until
  if (startTs !== undefined && typeof startTs !== 'number') return undefined
  if (endTs !== undefined && typeof endTs !== 'number') return undefined
  if (since !== null && typeof since !== 'string') return undefined
  if (until !== null && typeof until !== 'string') return undefined

  return {
    time: {
      ...(startTs !== undefined ? { startTs } : {}),
      ...(endTs !== undefined ? { endTs } : {}),
      meta: { since, until },
    },
  }
}

export function getCursorSnapshot(token: string): CursorSnapshot | undefined {
  return decodeCursorEnvelope(token)?.snapshot
}

/** Decode a cursor and validate it against the current query fingerprint. */
export function decodeCursor(token: string, fingerprint: string): number {
  const envelope = decodeCursorEnvelope(token)
  if (envelope) {
    if (envelope.fingerprint !== fingerprint) {
      throw new QueryError({
        code: 'CURSOR_INVALID',
        message: 'Cursor does not match the current query conditions',
        hint: 'Cursors are only valid for the exact query that produced them; re-run the query without --cursor',
      })
    }
    return envelope.offset
  }

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
