import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { adaptToolsForAgent } from './tool-adapter'
import type { ToolDefinition } from '@openchatlab/tools'
import type { ChartPayload, DatabaseAdapter } from '@openchatlab/core'
import { CHART_SCHEMA_REQUIRED_MESSAGE } from '@openchatlab/node-runtime'

const chart: ChartPayload = {
  version: 1,
  spec: {
    version: 1,
    type: 'pie',
    title: 'Selected members',
    encoding: { label: 'name', value: 'message_count' },
  },
  dataset: {
    columns: [
      { name: 'name', type: 'category' },
      { name: 'message_count', type: 'integer' },
    ],
    rows: [
      { name: 'Alice', message_count: 4 },
      { name: 'Bob', message_count: 3 },
    ],
  },
  data: {
    labels: ['Alice', 'Bob'],
    values: [4, 3],
  },
  rowCount: 2,
}

describe('adaptToolsForAgent', () => {
  it('requires get_schema before render_chart', async () => {
    let chartCalls = 0
    const tool: ToolDefinition = {
      name: 'render_chart',
      description: 'Render a chart',
      inputSchema: { type: 'object', properties: {} },
      async handler() {
        chartCalls += 1
        return { content: 'Generated chart.' }
      },
    }

    const [agentTool] = adaptToolsForAgent([tool], () => ({
      db: {} as DatabaseAdapter,
      sessionId: 'session-1',
      locale: 'en-US',
    }))

    const result = await agentTool.execute('call-1', {})

    assert.equal(chartCalls, 0)
    assert.deepEqual(result.content, [{ type: 'text', text: CHART_SCHEMA_REQUIRED_MESSAGE }])
    assert.equal(result.details, null)
  })

  it('preserves chart payloads in tool result details after schema lookup', async () => {
    const getSchemaTool: ToolDefinition = {
      name: 'get_schema',
      description: 'Get schema',
      inputSchema: { type: 'object', properties: {} },
      async handler() {
        return { content: 'message(id, ts)' }
      },
    }
    const tool: ToolDefinition = {
      name: 'render_chart',
      description: 'Render a chart',
      inputSchema: { type: 'object', properties: {} },
      async handler() {
        return {
          content: 'Generated chart.',
          data: { rowCount: 2 },
          chart,
        }
      },
    }

    const [getSchema, agentTool] = adaptToolsForAgent([getSchemaTool, tool], () => ({
      db: {} as DatabaseAdapter,
      sessionId: 'session-1',
      locale: 'en-US',
    }))

    assert.ok(agentTool)
    await getSchema.execute('call-0', {})
    const result = await agentTool.execute('call-1', {})

    assert.deepEqual(result.content, [{ type: 'text', text: 'Generated chart.' }])
    assert.deepEqual(result.details, { rowCount: 2, chart })
  })

  it('keeps rawMessages mirrored in data out of the LLM-facing text', async () => {
    const rawMessages = [
      { id: 1, senderName: 'Alice', content: 'hello world', timestamp: 1710000000 },
      { id: 2, senderName: 'Bob', content: 'hi there', timestamp: 1710000060 },
    ]
    const tool: ToolDefinition = {
      name: 'get_recent_messages',
      description: 'Recent messages',
      inputSchema: { type: 'object', properties: {} },
      async handler() {
        const data = { total: 2, timeRange: '全部时间', rawMessages }
        return { content: JSON.stringify(data), data, rawMessages }
      },
    }

    const [agentTool] = adaptToolsForAgent([tool], () => ({
      db: {} as DatabaseAdapter,
      sessionId: 'session-1',
      locale: 'zh-CN',
    }))

    const result = await agentTool.execute('call-1', {})
    const text = (result.content[0] as { type: 'text'; text: string }).text

    assert.ok(!text.includes('[object Object]'))
    assert.ok(text.includes('total: 2'))
    assert.ok(text.includes('hello world'))
    assert.ok(text.includes('hi there'))
  })
})
