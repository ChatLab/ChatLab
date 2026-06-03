import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderChartTool } from './render-chart'
import type { ToolDataProvider, ToolExecutionContext } from '../types'

const barSpec = {
  version: 1,
  type: 'bar',
  title: 'Messages by member',
  encoding: { x: 'name', y: 'message_count' },
} as const

function createContext(
  rows: Record<string, unknown>[],
  calls: Array<{ query: string; params: Record<string, unknown> }>
): ToolExecutionContext {
  const dataProvider = {
    async executeParameterizedSql(query: string, params: Record<string, unknown>) {
      calls.push({ query, params })
      return rows
    },
  } as Partial<ToolDataProvider> as ToolDataProvider

  return {
    sessionId: 'session-1',
    locale: 'en-US',
    dataProvider,
  }
}

describe('renderChartTool', () => {
  it('runs parameterized read-only SQL and returns a normalized chart payload', async () => {
    const calls: Array<{ query: string; params: Record<string, unknown> }> = []
    const context = createContext(
      [
        { name: 'Alice', message_count: 4 },
        { name: 'Bob', message_count: 3 },
      ],
      calls
    )

    const result = await renderChartTool.handler(
      {
        sql: 'SELECT name, message_count FROM member_stats WHERE days = @days',
        params: { days: 7 },
        chartSpec: barSpec,
        maxRows: 2,
      },
      context
    )

    assert.equal(calls.length, 1)
    assert.equal(
      calls[0]?.query,
      'SELECT * FROM (\nSELECT name, message_count FROM member_stats WHERE days = @days\n) AS chart_query LIMIT 3'
    )
    assert.deepEqual(calls[0]?.params, { days: 7 })
    assert.equal(result.chart?.spec.type, 'bar')
    assert.deepEqual(result.chart?.data, { labels: ['Alice', 'Bob'], values: [4, 3] })
    assert.deepEqual(result.chart?.dataset.rows, [
      { name: 'Alice', message_count: 4 },
      { name: 'Bob', message_count: 3 },
    ])
  })

  it('truncates rows after fetching one more than maxRows', async () => {
    const calls: Array<{ query: string; params: Record<string, unknown> }> = []
    const context = createContext(
      [
        { name: 'Alice', message_count: 4 },
        { name: 'Bob', message_count: 3 },
        { name: 'Cara', message_count: 2 },
      ],
      calls
    )

    const result = await renderChartTool.handler(
      {
        sql: 'WITH ranked AS (SELECT name, message_count FROM member_stats) SELECT name, message_count FROM ranked',
        chartSpec: barSpec,
        maxRows: 2,
      },
      context
    )

    assert.equal(
      calls[0]?.query,
      'SELECT * FROM (\nWITH ranked AS (SELECT name, message_count FROM member_stats) SELECT name, message_count FROM ranked\n) AS chart_query LIMIT 3'
    )
    assert.equal(result.chart?.rowCount, 2)
    assert.equal(result.chart?.truncated, true)
    assert.deepEqual(result.chart?.data, { labels: ['Alice', 'Bob'], values: [4, 3] })
  })

  it('rejects direct write statements before reaching the data provider', async () => {
    const calls: Array<{ query: string; params: Record<string, unknown> }> = []
    const context = createContext([], calls)

    await assert.rejects(async () => {
      await renderChartTool.handler(
        {
          sql: 'DELETE FROM message',
          chartSpec: barSpec,
        },
        context
      )
    }, /only accepts SELECT or WITH SELECT SQL/)
    assert.equal(calls.length, 0)
  })

  it('enforces an outer row limit even when SQL already has a LIMIT', async () => {
    const calls: Array<{ query: string; params: Record<string, unknown> }> = []
    const context = createContext([{ name: 'Alice', message_count: 4 }], calls)

    await renderChartTool.handler(
      {
        sql: 'SELECT name, message_count FROM member_stats LIMIT 100000',
        chartSpec: barSpec,
        maxRows: 2,
      },
      context
    )

    assert.equal(
      calls[0]?.query,
      'SELECT * FROM (\nSELECT name, message_count FROM member_stats LIMIT 100000\n) AS chart_query LIMIT 3'
    )
  })

  it('does not let a trailing line comment swallow the enforced row limit', async () => {
    const calls: Array<{ query: string; params: Record<string, unknown> }> = []
    const context = createContext([{ name: 'Alice', message_count: 4 }], calls)

    await renderChartTool.handler(
      {
        sql: 'SELECT name, message_count FROM member_stats -- model note',
        chartSpec: barSpec,
        maxRows: 2,
      },
      context
    )

    assert.equal(
      calls[0]?.query,
      'SELECT * FROM (\nSELECT name, message_count FROM member_stats -- model note\n) AS chart_query LIMIT 3'
    )
  })
})
