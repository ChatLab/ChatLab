import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { rebaseChatLabDemoDocuments } from './chatlab-demo-timeline'

const DEMO_TIME_ZONE_OFFSET_MINUTES = 8 * 60

function sourceTimestamp(date: string, time: string): number {
  return Math.floor(new Date(`${date}T${time}+08:00`).getTime() / 1000)
}

function createDocument(timestamps: number[], options: { includeTimeline?: boolean; offset?: number } = {}): string {
  const chatlab: Record<string, unknown> = {
    version: '0.0.2',
    exportedAt: sourceTimestamp('2000-01-01', '00:00:00'),
    generator: 'ChatLab Demo',
  }
  if (options.includeTimeline !== false) {
    chatlab.demoTimeline = {
      version: 1,
      mode: 'relative',
      referenceYear: 2000,
      timeZoneOffsetMinutes: options.offset ?? DEMO_TIME_ZONE_OFFSET_MINUTES,
    }
  }

  return JSON.stringify({
    chatlab,
    meta: { name: 'Demo', platform: 'qq', type: 'private' },
    members: [],
    messages: timestamps.map((timestamp, index) => ({
      sender: '1',
      accountName: 'Demo',
      timestamp,
      type: 0,
      platformMessageId: `m${index + 1}`,
      content: 'demo',
    })),
  })
}

describe('rebaseChatLabDemoDocuments', () => {
  it('rebases all documents with one offset and preserves their relative timeline', () => {
    const groupTimestamps = [sourceTimestamp('2000-02-01', '09:00:00'), sourceTimestamp('2000-12-10', '22:30:00')]
    const privateTimestamps = [sourceTimestamp('2000-07-11', '10:15:00'), sourceTimestamp('2000-12-09', '21:00:00')]
    const inputs = [createDocument(groupTimestamps), createDocument(privateTimestamps)]
    const now = new Date('2026-07-25T04:00:00.000Z')

    const result = rebaseChatLabDemoDocuments(inputs, now)
    const rebased = result.documents.map((document) => JSON.parse(document))
    const expectedLatest = new Date(now)
    expectedLatest.setDate(expectedLatest.getDate() - 1)
    expectedLatest.setHours(22, 30, 0, 0)

    assert.equal(result.sourceLatestTimestamp, groupTimestamps[1])
    assert.equal(result.latestTimestamp, Math.floor(expectedLatest.getTime() / 1000))
    assert.equal(result.offsetSeconds, result.latestTimestamp - result.sourceLatestTimestamp)
    assert.deepEqual(
      rebased[0].messages.map((message: { timestamp: number }) => message.timestamp),
      groupTimestamps.map((timestamp) => timestamp + result.offsetSeconds)
    )
    assert.deepEqual(
      rebased[1].messages.map((message: { timestamp: number }) => message.timestamp),
      privateTimestamps.map((timestamp) => timestamp + result.offsetSeconds)
    )
    assert.equal(rebased[0].chatlab.exportedAt, Math.floor(now.getTime() / 1000))
    assert.equal(rebased[1].chatlab.exportedAt, Math.floor(now.getTime() / 1000))
    assert.equal(inputs[0], createDocument(groupTimestamps))
  })

  it('supports previously published Demo documents without timeline metadata', () => {
    const source = sourceTimestamp('2026-12-10', '22:30:00')
    const now = new Date('2027-03-10T12:00:00.000Z')

    const result = rebaseChatLabDemoDocuments([createDocument([source], { includeTimeline: false })], now)
    const output = JSON.parse(result.documents[0])

    assert.equal(output.messages[0].timestamp, result.latestTimestamp)
    assert.ok(result.latestTimestamp < Math.floor(now.getTime() / 1000))
  })

  it('rejects inconsistent or malformed Demo timelines before import', () => {
    const timestamp = sourceTimestamp('2000-12-10', '22:30:00')

    assert.throws(
      () =>
        rebaseChatLabDemoDocuments([
          createDocument([timestamp], { offset: 480 }),
          createDocument([timestamp], { offset: 0 }),
        ]),
      /same time zone offset/
    )
    assert.throws(() => rebaseChatLabDemoDocuments(['{"chatlab":{},"messages":[]}']), /has no messages/)
    assert.throws(() => rebaseChatLabDemoDocuments(['not-json']), /not valid JSON/)
  })
})
