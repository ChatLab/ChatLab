import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getChartCapabilityAllowedBuiltinTools } from '@openchatlab/node-runtime'
import { getAllowedToolSet, getAvailableToolDefs } from './agent-stream-runner'

describe('CLI chart capability tool filtering', () => {
  it('does not expose uncategorized raw SQL in chart-only turns', () => {
    const allowedToolSet = new Set(getChartCapabilityAllowedBuiltinTools())

    const toolNames = getAvailableToolDefs(true, allowedToolSet).map((tool) => tool.name)

    assert.deepEqual(toolNames.sort(), ['get_schema', 'render_chart'])
    assert.ok(!toolNames.includes('execute_sql'))
  })

  it('keeps only chart core tools plus explicitly allowed analysis tools', () => {
    const allowedToolSet = new Set(getChartCapabilityAllowedBuiltinTools(['keyword_frequency', 'execute_sql']))

    const toolNames = getAvailableToolDefs(true, allowedToolSet).map((tool) => tool.name)

    assert.deepEqual(toolNames.sort(), ['get_schema', 'keyword_frequency', 'render_chart'])
    assert.ok(!toolNames.includes('execute_sql'))
  })

  it('can expose render_chart for auto skill turns with restrictive assistant tools', () => {
    const allowedToolSet = new Set(getChartCapabilityAllowedBuiltinTools(['keyword_frequency']))

    const toolNames = getAvailableToolDefs(false, allowedToolSet).map((tool) => tool.name)

    assert.ok(toolNames.includes('keyword_frequency'))
    assert.ok(toolNames.includes('render_chart'))
  })

  it('does not expose raw SQL when the assistant did not allow it', () => {
    const allowedToolSet = new Set(['keyword_frequency'])

    const toolNames = getAvailableToolDefs(false, allowedToolSet).map((tool) => tool.name)

    assert.ok(toolNames.includes('keyword_frequency'))
    assert.ok(!toolNames.includes('execute_sql'))
  })

  it('preserves an empty assistant allowlist instead of treating it as unrestricted', () => {
    const allowedToolSet = getAllowedToolSet(false, [])

    assert.ok(allowedToolSet instanceof Set)
    assert.equal(allowedToolSet.size, 0)

    const toolNames = getAvailableToolDefs(false, allowedToolSet).map((tool) => tool.name)

    assert.ok(toolNames.includes('get_schema'))
    assert.ok(!toolNames.includes('keyword_frequency'))
    assert.ok(!toolNames.includes('execute_sql'))
  })
})
