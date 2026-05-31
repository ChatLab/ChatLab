import assert from 'node:assert/strict'
import test from 'node:test'
import type { ToolExecutionContext } from '../types'
import { timeStatsTool } from './time-stats'

function createContext(rows: Array<Record<string, unknown>>): ToolExecutionContext {
  return {
    sessionId: 'test-session',
    dataProvider: {
      getTimeStats: async () => rows,
    } as unknown as ToolExecutionContext['dataProvider'],
  }
}

test('get_time_stats builds hourly chart values from messageCount', async () => {
  const result = await timeStatsTool.handler(
    { type: 'hourly' },
    createContext([
      { hour: 0, messageCount: 2 },
      { hour: 1, messageCount: 3 },
    ])
  )

  assert.deepEqual(result.chartHint?.data, {
    labels: ['0:00', '1:00'],
    values: [2, 3],
    horizontal: false,
  })
})

test('get_time_stats builds weekday chart labels for 1-7 weekdays', async () => {
  const result = await timeStatsTool.handler(
    { type: 'weekday' },
    createContext([
      { weekday: 1, messageCount: 5 },
      { weekday: 7, messageCount: 8 },
    ])
  )

  assert.deepEqual(result.chartHint?.data, {
    labels: ['周一', '周日'],
    values: [5, 8],
    horizontal: true,
  })
})

test('get_time_stats builds daily chart labels from date', async () => {
  const result = await timeStatsTool.handler(
    { type: 'daily' },
    createContext([
      { date: '2026-05-29', messageCount: 4 },
      { date: '2026-05-30', messageCount: 9 },
    ])
  )

  assert.deepEqual(result.chartHint?.data, {
    labels: ['2026-05-29', '2026-05-30'],
    values: [4, 9],
  })
})
