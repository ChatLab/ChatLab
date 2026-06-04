import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CHART_CAPABILITY_SKILL_ID } from '@openchatlab/core'
import { CHART_SCHEMA_REQUIRED_MESSAGE } from '@openchatlab/node-runtime'
import { createActivateSkillTool, getAllowedToolsForChartCapability, getAllTools } from './index'

describe('desktop chart capability tool filtering', () => {
  it('does not expose raw SQL tools in chart-only turns', () => {
    const toolNames = getAllowedToolsForChartCapability(['execute_sql'])

    assert.deepEqual(toolNames, ['render_chart'])
    assert.ok(!toolNames.includes('execute_sql'))
  })

  it('keeps explicitly allowed non-SQL analysis tools', () => {
    const toolNames = getAllowedToolsForChartCapability(['keyword_frequency', 'execute_sql'])

    assert.deepEqual(toolNames.sort(), ['keyword_frequency', 'render_chart'])
    assert.ok(!toolNames.includes('execute_sql'))
  })

  it('activates the built-in chart skill without an imported skill file', async () => {
    const tool = createActivateSkillTool('group', ['render_chart'], 'zh-CN')
    const result = await tool.execute('call_1', { skill_id: CHART_CAPABILITY_SKILL_ID })
    const block = result.content[0]

    assert.equal(result.details.skillId, CHART_CAPABILITY_SKILL_ID)
    assert.equal(result.details.applicable, true)
    assert.equal(block.type, 'text')
    if (block.type !== 'text') throw new Error('expected text content')
    assert.match(block.text, /render_chart/)
  })

  it('requires get_schema before desktop render_chart execution', async () => {
    const tools = getAllTools(
      {
        sessionId: 'session-1',
        locale: 'en-US',
      },
      ['render_chart']
    )
    const renderChart = tools.find((tool) => tool.name === 'render_chart')

    assert.ok(renderChart)
    const result = await renderChart.execute('call-1', {})

    assert.deepEqual(result.content, [{ type: 'text', text: CHART_SCHEMA_REQUIRED_MESSAGE }])
    assert.equal(result.details, null)
  })
})
