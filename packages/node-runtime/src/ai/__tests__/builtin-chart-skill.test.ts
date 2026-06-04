import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CHART_CAPABILITY_SKILL_ID } from '@openchatlab/core'

import { buildSkillMenuWithBuiltinChart, getSkillConfigWithBuiltinChart } from '../builtin-chart-skill'
import { buildSkillMenuText, formatSkillMenuLine } from '../skill-menu'

function requireMenu(menu: string | null): string {
  assert.ok(menu)
  return menu
}

describe('builtin chart skill helpers', () => {
  it('adds chart_runtime to an empty auto skill menu', () => {
    const menu = requireMenu(buildSkillMenuWithBuiltinChart(null, 'zh-CN'))

    assert.match(menu, /chart_runtime/)
    assert.match(menu, /绘图助手/)
    assert.match(menu, /不要输出 Python\/JS 绘图代码/)
  })

  it('appends chart_runtime to an existing auto skill menu', () => {
    const baseMenu = buildSkillMenuText([
      formatSkillMenuLine({
        id: 'existing',
        name: 'Existing Skill',
        description: 'Existing description',
      }),
    ])

    const menu = requireMenu(buildSkillMenuWithBuiltinChart(baseMenu, 'zh-CN'))

    assert.match(menu, /existing/)
    assert.match(menu, /chart_runtime/)
    assert.ok(menu.indexOf('existing') < menu.indexOf('chart_runtime'))
  })

  it('does not add chart_runtime when render_chart is unavailable', () => {
    const menu = buildSkillMenuWithBuiltinChart(null, 'zh-CN', [])

    assert.equal(menu, null)
  })

  it('adds chart_runtime when render_chart is explicitly available', () => {
    const menu = requireMenu(buildSkillMenuWithBuiltinChart(null, 'zh-CN', ['render_chart']))

    assert.match(menu, /chart_runtime/)
  })

  it('resolves chart_runtime without a user-imported skill file', () => {
    const skill = getSkillConfigWithBuiltinChart(CHART_CAPABILITY_SKILL_ID, 'en-US', () => null)

    assert.ok(skill)
    assert.equal(skill.id, CHART_CAPABILITY_SKILL_ID)
    assert.match(skill.prompt, /render_chart/)
  })
})
