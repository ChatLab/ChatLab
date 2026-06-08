import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  CHART_CAPABILITY_SKILL_ID,
  getChartPlannerCapabilityForMessage,
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
    assert.match(skill.prompt, /chart1\.png/)
    assert.match(skill.prompt, /Data preview/)
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

  it('can auto-enable chart runtime for analytical trend questions', () => {
    const runtime = resolveChartRuntimeForRequest({
      skillId: null,
      userMessage: '分析过去一年群里每季度消息量变化趋势，指出峰值和低谷。',
      locale: 'zh-CN',
      enableAutoDetection: true,
      enableAnalyticalAutoDetection: true,
    })

    assert.equal(runtime.isChartCapability, true)
    assert.equal(runtime.skillDef?.id, CHART_CAPABILITY_SKILL_ID)
    assert.deepEqual(runtime.allowedBuiltinTools, ['render_chart'])
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

  it('offers chart planner capability for analytical trend questions without explicit chart wording', () => {
    const capability = getChartPlannerCapabilityForMessage({
      userMessage: '分析过去一年群里话题的变化趋势，按季度总结主要变化。',
      locale: 'zh-CN',
      availableTools: ['get_schema', 'search_messages', 'render_chart'],
    })

    assert.equal(capability?.id, 'chart_generation')
    assert.deepEqual(capability?.tools, ['get_schema', 'render_chart'])
    assert.match(capability?.guidance ?? '', /趋势/)
    assert.match(capability?.guidance ?? '', /get_schema/)
    assert.match(capability?.guidance ?? '', /render_chart/)
  })

  it('does not offer chart planner capability when render_chart is unavailable', () => {
    const capability = getChartPlannerCapabilityForMessage({
      userMessage: '分析过去一年群里话题的变化趋势。',
      locale: 'zh-CN',
      availableTools: ['get_schema', 'search_messages'],
    })

    assert.equal(capability, null)
  })
})
