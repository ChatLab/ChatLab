import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  CHART_CAPABILITY_ANALYSIS_TOOLS,
  CHART_CAPABILITY_CORE_TOOLS,
  CHART_CAPABILITY_SKILL_ID,
  getChartCapabilityAllowedBuiltinTools,
  getChartCapabilitySkill,
  shouldUseChartCapabilityForMessage,
} from './chart-capability'

describe('chart capability skill', () => {
  it('advertises render_chart and schema lookup tools', () => {
    const skill = getChartCapabilitySkill('en-US')

    assert.equal(skill.id, CHART_CAPABILITY_SKILL_ID)
    assert.deepEqual(skill.tools, ['render_chart', 'get_schema'])
    assert.deepEqual(CHART_CAPABILITY_CORE_TOOLS, ['get_schema'])
    assert.match(skill.prompt, /render_chart/)
    assert.match(skill.prompt, /get_schema/)
  })

  it('instructs common phrase charts to exclude non-human placeholders', () => {
    const zhSkill = getChartCapabilitySkill('zh-CN')
    const enSkill = getChartCapabilitySkill('en-US')

    assert.match(zhSkill.prompt, /常用语、口头禅、高频短句/)
    assert.match(zhSkill.prompt, /\[表情包\]/)
    assert.match(zhSkill.prompt, /撤回\/删除提示/)
    assert.match(enSkill.prompt, /catchphrase, common phrase, or frequent short-text charts/)
    assert.match(enSkill.prompt, /\[Sticker\]/)
    assert.match(enSkill.prompt, /recall\/deletion notices/)
  })

  it('tightens chart SQL and final-answer behavior', () => {
    const zhSkill = getChartCapabilitySkill('zh-CN')
    const enSkill = getChartCapabilitySkill('en-US')

    assert.match(zhSkill.prompt, /必须先调用 get_schema/)
    assert.match(zhSkill.prompt, /禁止猜测表名、字段名或时间字段/)
    assert.match(zhSkill.prompt, /MAX\(ts\)/)
    assert.match(zhSkill.prompt, /禁止写 ts\/1000/)
    assert.match(zhSkill.prompt, /补齐日期 × series 的 0 值/)
    assert.match(zhSkill.prompt, /工具失败、SQL 修正、schema 探索过程不要写进最终回答/)
    assert.match(zhSkill.prompt, /禁止夸张拟人化/)

    assert.match(enSkill.prompt, /Always call get_schema/)
    assert.match(enSkill.prompt, /Do not guess table names/)
    assert.match(enSkill.prompt, /never write ts\/1000/)
    assert.match(enSkill.prompt, /fill the date x series grid with zero values/)
    assert.match(enSkill.prompt, /Do not include failed SQL attempts/)
    assert.match(enSkill.prompt, /Do not make exaggerated personality or relationship claims/)
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

  it('detects explicit chart requests', () => {
    assert.equal(shouldUseChartCapabilityForMessage('画一个前五常用语占比饼图'), true)
    assert.equal(shouldUseChartCapabilityForMessage('帮我做一下热力图'), true)
    assert.equal(shouldUseChartCapabilityForMessage('visualize member trends as a line chart'), true)
    assert.equal(shouldUseChartCapabilityForMessage('分析一下谁说话最多'), false)
  })
})
