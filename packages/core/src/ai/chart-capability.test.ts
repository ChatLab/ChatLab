import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  CHART_CAPABILITY_ANALYSIS_TOOLS,
  CHART_CAPABILITY_SKILL_ID,
  getChartCapabilityAllowedBuiltinTools,
  getChartCapabilitySkill,
} from './chart-capability'

describe('chart capability skill', () => {
  it('advertises render_chart and schema lookup tools', () => {
    const skill = getChartCapabilitySkill('en-US')

    assert.equal(skill.id, CHART_CAPABILITY_SKILL_ID)
    assert.deepEqual(skill.tools, ['render_chart', 'get_schema'])
    assert.match(skill.prompt, /render_chart/)
    assert.match(skill.prompt, /get_schema/)
  })

  it('adds only chart analysis tools to assistant builtin tools', () => {
    assert.deepEqual(CHART_CAPABILITY_ANALYSIS_TOOLS, ['render_chart'])
    assert.deepEqual(getChartCapabilityAllowedBuiltinTools(), ['render_chart'])
    assert.deepEqual(getChartCapabilityAllowedBuiltinTools(['keyword_frequency']), [
      'keyword_frequency',
      'render_chart',
    ])
  })

  it('does not duplicate render_chart when it is already allowed', () => {
    assert.deepEqual(getChartCapabilityAllowedBuiltinTools(['render_chart', 'time_stats']), [
      'render_chart',
      'time_stats',
    ])
  })
})
