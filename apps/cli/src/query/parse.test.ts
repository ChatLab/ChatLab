/**
 * Tests for query argument parsing: time boundary semantics (date-only spans
 * the whole day), the closed keyword set, --last exclusivity, limit clamping,
 * and cursor fingerprint validation.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseTimeOptions,
  parseLimit,
  queryFingerprint,
  encodeCursor,
  decodeCursor,
  epochToIso,
  resolveTimeOptionsForCursor,
} from './parse'
import { QueryError } from './envelope'

// Fixed reference: 2026-07-03 15:30:00 local time
const NOW = new Date(2026, 6, 3, 15, 30, 0)

function localEpoch(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  return Math.floor(new Date(y, mo - 1, d, h, mi, s).getTime() / 1000)
}

describe('parseTimeOptions', () => {
  it('resolves date-only --since to start of day and --until to end of day', () => {
    const range = parseTimeOptions({ since: '2026-06-01', until: '2026-06-30' }, NOW)
    assert.equal(range.startTs, localEpoch(2026, 6, 1))
    assert.equal(range.endTs, localEpoch(2026, 6, 30, 23, 59, 59))
  })

  it('resolves today/yesterday keywords against now', () => {
    const range = parseTimeOptions({ since: 'yesterday', until: 'today' }, NOW)
    assert.equal(range.startTs, localEpoch(2026, 7, 2))
    assert.equal(range.endTs, localEpoch(2026, 7, 3, 23, 59, 59))
  })

  it('accepts "YYYY-MM-DD HH:mm" and full ISO 8601', () => {
    const range = parseTimeOptions({ since: '2026-05-31 08:30', until: '2026-06-01T10:00:00+08:00' }, NOW)
    assert.equal(range.startTs, localEpoch(2026, 5, 31, 8, 30))
    assert.equal(range.endTs, Math.floor(new Date('2026-06-01T10:00:00+08:00').getTime() / 1000))
  })

  it('resolves --last relative windows and echoes absolute bounds', () => {
    const range = parseTimeOptions({ last: '30d' }, NOW)
    assert.equal(range.startTs, Math.floor(NOW.getTime() / 1000) - 30 * 86400)
    assert.equal(range.endTs, undefined)
    assert.ok(range.meta.since)
    assert.ok(range.meta.until)
  })

  it('rejects --last combined with --since/--until', () => {
    assert.throws(
      () => parseTimeOptions({ last: '7d', since: '2026-06-01' }, NOW),
      (err: unknown) => err instanceof QueryError && err.code === 'INVALID_ARGUMENT'
    )
  })

  it('rejects unsupported natural language and bad units', () => {
    for (const bad of [{ since: 'last week' }, { last: '3mo' }, { until: '06/30/2026' }]) {
      assert.throws(
        () => parseTimeOptions(bad, NOW),
        (err: unknown) => err instanceof QueryError && err.code === 'INVALID_ARGUMENT',
        JSON.stringify(bad)
      )
    }
  })

  it('rejects invalid calendar dates instead of normalizing them', () => {
    for (const bad of [
      { since: '2026-02-31' },
      { until: '2026-13-01' },
      { since: '2026-02-31 08:30' },
      { since: '2026-06-01 25:00' },
      { until: '2026-02-31T10:00:00+08:00' },
    ]) {
      assert.throws(
        () => parseTimeOptions(bad, NOW),
        (err: unknown) => err instanceof QueryError && err.code === 'INVALID_ARGUMENT',
        JSON.stringify(bad)
      )
    }
  })

  it('rejects inverted ranges', () => {
    assert.throws(
      () => parseTimeOptions({ since: '2026-07-01', until: '2026-06-01' }, NOW),
      (err: unknown) => err instanceof QueryError && err.code === 'INVALID_ARGUMENT'
    )
  })

  it('echoes resolved boundaries in meta for self-verification', () => {
    const range = parseTimeOptions({ since: '2026-06-01', until: '2026-06-30' }, NOW)
    assert.equal(range.meta.since, epochToIso(localEpoch(2026, 6, 1)))
    assert.equal(range.meta.until, epochToIso(localEpoch(2026, 6, 30, 23, 59, 59)))
  })
})

describe('parseLimit', () => {
  it('applies default and hard cap', () => {
    assert.equal(parseLimit(undefined, 50, 500, '--limit'), 50)
    assert.equal(parseLimit('30', 50, 500, '--limit'), 30)
    assert.equal(parseLimit('9999', 50, 500, '--limit'), 500)
  })

  it('rejects non-integer values', () => {
    for (const bad of ['abc', '-1', '1.5']) {
      assert.throws(
        () => parseLimit(bad, 50, 500, '--limit'),
        (err: unknown) => err instanceof QueryError && err.code === 'INVALID_ARGUMENT',
        bad
      )
    }
  })

  it('can reject zero for cursor-paginated page sizes', () => {
    assert.equal(parseLimit('0', 0, 50, '--context'), 0)
    assert.throws(
      () => parseLimit('0', 50, 500, '--limit', 1),
      (err: unknown) => err instanceof QueryError && err.code === 'INVALID_ARGUMENT'
    )
  })
})

describe('cursor', () => {
  it('round-trips offset for the same query fingerprint', () => {
    const fp = queryFingerprint({ command: 'messages.search', keywords: ['旅游'] })
    const token = encodeCursor(120, fp)
    assert.equal(decodeCursor(token, fp), 120)
  })

  it('rejects cursors from different query conditions', () => {
    const fpA = queryFingerprint({ command: 'messages.search', keywords: ['旅游'] })
    const fpB = queryFingerprint({ command: 'messages.search', keywords: ['报销'] })
    const token = encodeCursor(120, fpA)
    assert.throws(
      () => decodeCursor(token, fpB),
      (err: unknown) => err instanceof QueryError && err.code === 'CURSOR_INVALID'
    )
  })

  it('rejects garbage cursors', () => {
    const fp = queryFingerprint({ command: 'messages.list' })
    assert.throws(
      () => decodeCursor('not-a-cursor', fp),
      (err: unknown) => err instanceof QueryError && err.code === 'CURSOR_INVALID'
    )
  })

  it('reuses frozen time bounds embedded in cursor tokens', () => {
    const firstRange = resolveTimeOptionsForCursor({ last: '7d' }, NOW)
    const fp = queryFingerprint({
      command: 'messages.list',
      startTs: firstRange.startTs ?? null,
      endTs: firstRange.endTs ?? null,
    })
    const token = encodeCursor(50, fp, { time: firstRange })

    const later = new Date(NOW.getTime() + 60_000)
    const secondRange = resolveTimeOptionsForCursor({ last: '7d', cursor: token }, later)
    assert.deepEqual(secondRange, firstRange)
    assert.equal(decodeCursor(token, fp), 50)
  })
})
