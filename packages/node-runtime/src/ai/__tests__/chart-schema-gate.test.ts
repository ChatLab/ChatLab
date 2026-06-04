import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import {
  CHART_SCHEMA_REQUIRED_MESSAGE,
  createChartSchemaGateState,
  wrapWithChartSchemaGate,
} from '../chart-schema-gate'

function createTool(name: string, calls: string[]): AgentTool<any, any> {
  return {
    name,
    label: name,
    description: name,
    parameters: { type: 'object', properties: {}, required: [] },
    async execute() {
      calls.push(name)
      return { content: [{ type: 'text', text: `${name} ok` }], details: { name } }
    },
  }
}

describe('chart schema gate', () => {
  it('blocks render_chart until get_schema has been called in the same tool set', async () => {
    const calls: string[] = []
    const state = createChartSchemaGateState()
    const renderChart = wrapWithChartSchemaGate(createTool('render_chart', calls), state)

    const result = await renderChart.execute('call-1', {})

    assert.deepEqual(calls, [])
    assert.deepEqual(result.content, [{ type: 'text', text: CHART_SCHEMA_REQUIRED_MESSAGE }])
    assert.equal(result.details, null)
  })

  it('allows render_chart after get_schema has been called', async () => {
    const calls: string[] = []
    const state = createChartSchemaGateState()
    const getSchema = wrapWithChartSchemaGate(createTool('get_schema', calls), state)
    const renderChart = wrapWithChartSchemaGate(createTool('render_chart', calls), state)

    await getSchema.execute('call-1', {})
    const result = await renderChart.execute('call-2', {})

    assert.deepEqual(calls, ['get_schema', 'render_chart'])
    assert.deepEqual(result.content, [{ type: 'text', text: 'render_chart ok' }])
  })
})
