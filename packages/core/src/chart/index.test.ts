import assert from 'node:assert/strict'
import test from 'node:test'
import { buildChartPayload, ChartValidationError } from './index'

test('builds a pie chart from dynamic label/value fields', () => {
  const chart = buildChartPayload(
    [
      { member_name: 'Alice', msg_count: 3 },
      { member_name: 'Bob', msg_count: 5 },
    ],
    {
      version: 1,
      type: 'pie',
      title: 'Selected members',
      encoding: { label: 'member_name', value: 'msg_count' },
    }
  )

  assert.equal(chart.spec.type, 'pie')
  assert.deepEqual(chart.data, { labels: ['Alice', 'Bob'], values: [3, 5] })
})

test('builds line series when encoding.series is provided', () => {
  const chart = buildChartPayload(
    [
      { day: '2026-06-01', member_name: 'Alice', msg_count: 2 },
      { day: '2026-06-01', member_name: 'Bob', msg_count: 4 },
      { day: '2026-06-02', member_name: 'Alice', msg_count: 1 },
    ],
    {
      version: 1,
      type: 'line',
      title: 'Member trend',
      encoding: { x: 'day', y: 'msg_count', series: 'member_name' },
    }
  )

  assert.deepEqual(chart.data, {
    labels: ['2026-06-01', '2026-06-02'],
    values: [2, 1],
    series: [
      { name: 'Alice', values: [2, 1] },
      { name: 'Bob', values: [4, 0] },
    ],
  })
})

test('builds heatmap indices from x/y/value fields', () => {
  const chart = buildChartPayload(
    [
      { hour: 9, weekday: 'Mon', msg_count: 2 },
      { hour: 10, weekday: 'Mon', msg_count: 3 },
      { hour: 9, weekday: 'Tue', msg_count: 4 },
    ],
    {
      version: 1,
      type: 'heatmap',
      title: 'Activity heatmap',
      encoding: { x: 'hour', y: 'weekday', value: 'msg_count' },
    }
  )

  assert.deepEqual(chart.data, {
    xLabels: ['9', '10'],
    yLabels: ['Mon', 'Tue'],
    data: [
      [0, 0, 2],
      [1, 0, 3],
      [0, 1, 4],
    ],
  })
})

test('rejects missing encoding fields', () => {
  assert.throws(
    () =>
      buildChartPayload([{ label: 'Alice', count: 1 }], {
        version: 1,
        type: 'bar',
        title: 'Broken chart',
        encoding: { x: 'label', y: 'missing_count' },
      }),
    ChartValidationError
  )
})
