import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CHART_CAPABILITY_SKILL_ID } from '@openchatlab/core'

import { buildSkillMenuWithBuiltinChart, getSkillConfigWithBuiltinChart } from '../builtin-chart-skill'

describe('builtin chart skill helpers', () => {
  it('adds chart_runtime to an empty auto skill menu', () => {
    const menu = buildSkillMenuWithBuiltinChart(null, 'zh-CN')

    assert.match(menu, /chart_runtime/)
    assert.match(menu, /绘图助手/)
    assert.match(menu, /不要输出 Python\/JS 绘图代码/)
  })

  it('appends chart_runtime to an existing auto skill menu', () => {
    const baseMenu = `## 可用技能
以下是你可以使用的分析技能。当你判断用户的问题适合使用某个技能时，
请调用 activate_skill 工具激活它，然后按照返回的指导完成任务。

- existing: Existing Skill — Existing description

如果用户的问题不需要使用技能，直接回答即可。`

    const menu = buildSkillMenuWithBuiltinChart(baseMenu, 'zh-CN')

    assert.match(menu, /existing/)
    assert.match(menu, /chart_runtime/)
    assert.ok(menu.indexOf('existing') < menu.indexOf('chart_runtime'))
  })

  it('resolves chart_runtime without a user-imported skill file', () => {
    const skill = getSkillConfigWithBuiltinChart(CHART_CAPABILITY_SKILL_ID, 'en-US', () => null)

    assert.ok(skill)
    assert.equal(skill.id, CHART_CAPABILITY_SKILL_ID)
    assert.match(skill.prompt, /render_chart/)
  })
})
