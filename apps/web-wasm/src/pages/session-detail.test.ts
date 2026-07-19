import assert from 'node:assert/strict'
import test from 'node:test'
import { buildHourlyChartData, buildMemberRankItems, buildMessageTypeChartData } from './session-detail'

test('builds a complete 24-hour chart and fills missing hours with zero', () => {
  const result = buildHourlyChartData([
    { hour: 8, messageCount: 2 },
    { hour: 23, messageCount: 1 },
  ])

  assert.equal(result.labels.length, 24)
  assert.equal(result.values.length, 24)
  assert.equal(result.labels[0], '0')
  assert.equal(result.labels[23], '23')
  assert.equal(result.values[8], 2)
  assert.equal(result.values[23], 1)
  assert.equal(result.values[7], 0)
})

test('maps member activity into the shared ranking component contract', () => {
  assert.deepEqual(
    buildMemberRankItems([
      {
        memberId: 7,
        platformId: 'alice',
        name: 'Alice',
        avatar: null,
        messageCount: 12,
        percentage: 75,
      },
    ]),
    [{ id: '7', name: 'Alice', value: 12, percentage: 75 }]
  )
})

test('maps message type stats into the shared pie chart contract in descending order', () => {
  const source = [
    { type: 0, count: 1 },
    { type: 1, count: 3 },
  ]

  assert.deepEqual(
    buildMessageTypeChartData(source, (type) => `type-${type}`),
    {
      labels: ['type-1', 'type-0'],
      values: [3, 1],
    }
  )
  assert.deepEqual(source, [
    { type: 0, count: 1 },
    { type: 1, count: 3 },
  ])
})
