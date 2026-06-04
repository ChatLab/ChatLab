import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  CHART_CAPABILITY_SKILL_ID,
  getAllowedBuiltinToolsForChartAutoSkill,
  getChartCapabilityAllowedBuiltinTools,
  getChartCapabilitySkill,
  resolveChartRuntimeForRequest,
} from '../chart-runtime'

describe('chart runtime policy', () => {
  it('keeps chart prompt and skill metadata in node runtime', () => {
    const skill = getChartCapabilitySkill('en-US')

    assert.equal(skill.id, CHART_CAPABILITY_SKILL_ID)
    assert.equal(skill.name, 'Chart Assistant')
    assert.deepEqual(skill.tools, ['render_chart', 'get_schema'])
    assert.match(skill.prompt, /render_chart/)
  })

  it('enables chart runtime only for explicit chart skill by default', () => {
    assert.equal(
      resolveChartRuntimeForRequest({
        skillId: CHART_CAPABILITY_SKILL_ID,
        userMessage: 'draw a chart',
        locale: 'en-US',
      }).isChartCapability,
      true
    )

    assert.equal(
      resolveChartRuntimeForRequest({
        skillId: null,
        userMessage: '画一个趋势图',
        locale: 'zh-CN',
      }).isChartCapability,
      false
    )
  })

  it('keeps chart tool allowlists free of raw SQL', () => {
    assert.deepEqual(getChartCapabilityAllowedBuiltinTools(), ['render_chart'])
    assert.deepEqual(getChartCapabilityAllowedBuiltinTools(['keyword_frequency', 'execute_sql']), [
      'keyword_frequency',
      'render_chart',
    ])
  })

  it('does not narrow unrestricted auto-skill assistant tools', () => {
    assert.equal(getAllowedBuiltinToolsForChartAutoSkill(undefined), undefined)
    assert.deepEqual(getAllowedBuiltinToolsForChartAutoSkill([]), [])
    assert.deepEqual(getAllowedBuiltinToolsForChartAutoSkill(['keyword_frequency']), [
      'keyword_frequency',
      'render_chart',
    ])
  })

  it('does not remove raw SQL from non-chart auto-skill turns', () => {
    assert.deepEqual(getAllowedBuiltinToolsForChartAutoSkill(['execute_sql', 'keyword_frequency']), [
      'execute_sql',
      'keyword_frequency',
      'render_chart',
    ])
  })
})
