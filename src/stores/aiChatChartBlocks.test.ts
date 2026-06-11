import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ChartPayload } from '@openchatlab/core'
import {
  createRenderOnlyToolPendingBlock,
  extractChartPayloads,
  finishRenderOnlyToolResultBlocks,
  isRenderOnlyTool,
  replaceRenderOnlyToolPendingBlockWithCharts,
  shouldHideRecoverableChartError,
  toChartContentBlocks,
  toRenderOnlyToolErrorBlock,
} from './aiChatChartBlocks'

const chart: ChartPayload = {
  version: 1,
  spec: {
    version: 1,
    type: 'line',
    title: 'Daily messages',
    encoding: { x: 'day', y: 'message_count', series: 'member_name' },
  },
  dataset: {
    columns: [
      { name: 'day', type: 'date' },
      { name: 'member_name', type: 'category' },
      { name: 'message_count', type: 'integer' },
    ],
    rows: [{ day: '2026-06-01', member_name: 'Alice', message_count: 4 }],
  },
  data: {
    labels: ['2026-06-01'],
    values: [4],
    series: [{ name: 'Alice', values: [4] }],
  },
  rowCount: 1,
}

const secondChart: ChartPayload = {
  ...chart,
  spec: {
    ...chart.spec,
    type: 'pie',
    title: 'Selected members',
    encoding: { label: 'member_name', value: 'message_count' },
  },
  data: {
    labels: ['Alice'],
    values: [4],
  },
}

describe('aiChat chart block helpers', () => {
  it('treats render_chart as render-only', () => {
    assert.equal(isRenderOnlyTool('render_chart'), true)
    assert.equal(isRenderOnlyTool('search_messages'), false)
    assert.equal(isRenderOnlyTool(undefined), false)
  })

  it('creates a transient running block for render-only tools', () => {
    assert.deepEqual(createRenderOnlyToolPendingBlock('render_chart', { title: '趋势图' }, 'call_chart'), {
      type: 'tool',
      tool: {
        name: 'render_chart',
        displayName: 'render_chart',
        status: 'running',
        params: { title: '趋势图' },
        toolCallId: 'call_chart',
        transient: true,
      },
    })
    assert.equal(createRenderOnlyToolPendingBlock('search_messages', {}, 'call_search'), null)
  })

  it('extracts chart payloads from agent result details', () => {
    const result = {
      content: [{ type: 'text', text: 'Generated chart.' }],
      details: { rowCount: 1, chart },
    }

    assert.deepEqual(extractChartPayloads(result), [chart])
  })

  it('extracts multiple chart payloads and filters invalid entries', () => {
    const result = {
      details: {
        charts: [chart, { version: 1, spec: null }, secondChart],
      },
    }

    assert.deepEqual(extractChartPayloads(result), [chart, secondChart])
  })

  it('supports top-level chart payload fallback', () => {
    assert.deepEqual(extractChartPayloads({ chart }), [chart])
  })

  it('converts chart payloads to content blocks', () => {
    const blocks = toChartContentBlocks([chart, secondChart])

    assert.deepEqual(blocks, [
      { type: 'chart', chart: { ...chart, dataset: { ...chart.dataset, rows: [] } } },
      { type: 'chart', chart: { ...secondChart, dataset: { ...secondChart.dataset, rows: [] } } },
    ])
    assert.equal(blocks[0].chart.rowCount, chart.rowCount)
  })

  it('replaces a transient render-only tool block with generated charts', () => {
    const blocks = [
      { type: 'think', tag: 'thinking', text: '准备生成图表' },
      createRenderOnlyToolPendingBlock('render_chart', { title: '趋势图' }, 'call_chart'),
    ].filter((block): block is NonNullable<typeof block> => block !== null)

    const nextBlocks = replaceRenderOnlyToolPendingBlockWithCharts(blocks, 'render_chart', 'call_chart', [chart])

    assert.deepEqual(
      nextBlocks.map((block) => block.type),
      ['think', 'chart']
    )
    assert.equal(nextBlocks[1]?.type, 'chart')
  })

  it('does not append duplicate render-only charts already present in the message', () => {
    const reorderedSpecChart: ChartPayload = {
      ...chart,
      spec: {
        encoding: { series: 'member_name', y: 'message_count', x: 'day' },
        title: chart.spec.title,
        type: chart.spec.type,
        version: chart.spec.version,
      },
      dataset: {
        ...chart.dataset,
        rows: [{ day: '2026-06-01', member_name: 'Alice', message_count: 4 }],
      },
    }
    const blocks = [
      { type: 'chart', chart: { ...chart, dataset: { ...chart.dataset, rows: [] } } },
      { type: 'think', tag: 'thinking', text: '再看剩余月份' },
      createRenderOnlyToolPendingBlock('render_chart', { title: '趋势图' }, 'call_chart_2'),
    ].filter((block): block is NonNullable<typeof block> => block !== null)

    const nextBlocks = replaceRenderOnlyToolPendingBlockWithCharts(blocks, 'render_chart', 'call_chart_2', [
      reorderedSpecChart,
    ])

    assert.deepEqual(
      nextBlocks.map((block) => block.type),
      ['chart', 'think']
    )
  })

  it('converts render-only chart tool failures to visible error blocks', () => {
    const errorBlock = toRenderOnlyToolErrorBlock('render_chart', {
      content: [{ type: 'text', text: 'Error: Field "missing_count" does not exist in SQL result' }],
      details: null,
    })

    assert.deepEqual(errorBlock, {
      type: 'error',
      error: {
        name: 'ChartRenderError',
        message: 'Field "missing_count" does not exist in SQL result',
        stack: null,
      },
    })
  })

  it('does not create render-only error blocks for successful charts or normal tools', () => {
    assert.equal(toRenderOnlyToolErrorBlock('render_chart', { details: { chart } }), null)
    assert.equal(
      toRenderOnlyToolErrorBlock('search_messages', {
        content: [{ type: 'text', text: 'Error: search failed' }],
      }),
      null
    )
  })

  it('does not expose recoverable schema-gate guidance as a user-visible error', () => {
    assert.equal(
      toRenderOnlyToolErrorBlock('render_chart', {
        content: [
          {
            type: 'text',
            text: 'Error: Call get_schema before render_chart. Do not guess table names, fields, or timestamp units.',
          },
        ],
      }),
      null
    )
  })

  it('removes transient render-only rows when a recoverable result produces no chart', () => {
    const blocks = [
      { type: 'think', tag: 'thinking', text: '准备生成图表' },
      createRenderOnlyToolPendingBlock('render_chart', { spec: { title: '趋势图' } }, 'call_schema_gate'),
    ].filter((block): block is NonNullable<typeof block> => block !== null)
    const errorBlock = toRenderOnlyToolErrorBlock('render_chart', {
      content: [
        {
          type: 'text',
          text: 'Error: Call get_schema before render_chart. Do not guess table names, fields, or timestamp units.',
        },
      ],
    })

    const nextBlocks = finishRenderOnlyToolResultBlocks(blocks, 'render_chart', 'call_schema_gate', [], errorBlock)

    assert.deepEqual(
      nextBlocks.map((block) => block.type),
      ['think']
    )
  })

  it('hides recovered chart render errors when a later native chart exists', () => {
    const blocks = [
      { type: 'error', error: { name: 'ChartRenderError', message: 'Field "metric" does not exist in SQL result' } },
      { type: 'think', text: '修正 SQL' },
      { type: 'chart', chart },
    ]

    assert.equal(shouldHideRecoverableChartError(blocks, 0), true)
    assert.equal(shouldHideRecoverableChartError(blocks.slice(0, 2), 0), false)
    assert.equal(
      shouldHideRecoverableChartError(
        [{ type: 'error', error: { name: 'OtherError', message: 'boom' } }, blocks[2]],
        0
      ),
      false
    )
  })

  it('hides chart render errors while the assistant message is still streaming', () => {
    const blocks = [
      {
        type: 'error',
        error: { name: 'ChartRenderError', message: 'encoding.x must be a non-empty field name' },
      },
    ]

    assert.equal(shouldHideRecoverableChartError(blocks, 0, { isStreaming: true }), true)
    assert.equal(shouldHideRecoverableChartError(blocks, 0, { isStreaming: false }), false)
  })
})
