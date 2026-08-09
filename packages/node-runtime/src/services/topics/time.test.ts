import assert from 'node:assert/strict'
import test from 'node:test'
import { assertValidTopicDayKey, enumerateTopicDays, formatTopicDayKey, getTopicDayRange } from './time'

test('day ranges follow the requested timezone rather than the host timezone', () => {
  const range = getTopicDayRange('2026-08-09', 'Asia/Shanghai')
  assert.equal(range.startTs, Date.parse('2026-08-08T16:00:00.000Z') / 1000)
  assert.equal(range.endTs, Date.parse('2026-08-09T16:00:00.000Z') / 1000)
  assert.equal(formatTopicDayKey(range.startTs, 'Asia/Shanghai'), '2026-08-09')
})

test('day ranges preserve daylight-saving boundaries', () => {
  const spring = getTopicDayRange('2026-03-08', 'America/New_York')
  const autumn = getTopicDayRange('2026-11-01', 'America/New_York')
  assert.equal(spring.endTs - spring.startTs, 23 * 60 * 60)
  assert.equal(autumn.endTs - autumn.startTs, 25 * 60 * 60)
})

test('day ranges start at the first valid instant when daylight saving skips midnight', () => {
  const range = getTopicDayRange('2024-03-10', 'America/Havana')
  assert.equal(range.startTs, Date.parse('2024-03-10T05:00:00.000Z') / 1000)
  assert.equal(range.endTs, Date.parse('2024-03-11T04:00:00.000Z') / 1000)
  assert.equal(range.endTs - range.startTs, 23 * 60 * 60)
  assert.equal(formatTopicDayKey(range.startTs, 'America/Havana'), '2024-03-10')
  assert.equal(formatTopicDayKey(range.startTs - 1, 'America/Havana'), '2024-03-09')
})

test('calendar day enumeration validates dates and spans month boundaries', () => {
  assert.deepEqual(enumerateTopicDays('2026-01-30', '2026-02-02'), [
    '2026-01-30',
    '2026-01-31',
    '2026-02-01',
    '2026-02-02',
  ])
  assert.throws(() => enumerateTopicDays('2026-02-30', '2026-03-01'), /Invalid day key/)
})

test('custom topic start days require a real calendar date', () => {
  assert.doesNotThrow(() => assertValidTopicDayKey('2026-06-15'))
  assert.throws(() => assertValidTopicDayKey('2026-02-30'), /Invalid day key/)
  assert.throws(() => assertValidTopicDayKey('06-15-2026'), /Invalid day key/)
})
