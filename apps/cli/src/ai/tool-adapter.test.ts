import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { adaptToolsForAgent } from './tool-adapter'
import type { ToolDefinition } from '@openchatlab/tools'
import type { ChartPayload, DatabaseAdapter } from '@openchatlab/core'

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
  it('preserves chart payloads in tool result details', async () => {
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

    const [agentTool] = adaptToolsForAgent([tool], () => ({
      db: {} as DatabaseAdapter,
      sessionId: 'session-1',
      locale: 'en-US',
    }))

    assert.ok(agentTool)
    const result = await agentTool.execute('call-1', {})

    assert.deepEqual(result.content, [{ type: 'text', text: 'Generated chart.' }])
    assert.deepEqual(result.details, { rowCount: 2, chart })
  })
})
