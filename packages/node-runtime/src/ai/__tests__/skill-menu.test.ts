import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { appendSkillMenuLines, buildSkillMenuText, formatSkillMenuLine } from '../skill-menu'

describe('skill menu builder', () => {
  it('returns null when there are no visible skill items', () => {
    assert.equal(buildSkillMenuText([]), null)
  })

  it('builds the shared auto skill menu template', () => {
    const menu = buildSkillMenuText([
      formatSkillMenuLine({
        id: 'summary',
        name: 'Summary',
        description: 'Summarize the current chat',
      }),
    ])

    assert.ok(menu)
    assert.match(menu, /^## 可用技能/)
    assert.match(menu, /activate_skill 工具激活/)
    assert.match(menu, /- summary: Summary — Summarize the current chat/)
    assert.match(menu, /如果用户的问题不需要使用技能，直接回答即可。$/)
  })

  it('appends generated skill lines before the shared closing guidance', () => {
    const baseMenu = buildSkillMenuText([
      formatSkillMenuLine({
        id: 'existing',
        name: 'Existing Skill',
        description: 'Existing description',
      }),
    ])

    const menu = appendSkillMenuLines(baseMenu, [
      formatSkillMenuLine({
        id: 'chart_runtime',
        name: '绘图助手',
        description: '按本轮问题生成灵活的聊天数据图表',
      }),
    ])

    assert.ok(menu)
    assert.ok(menu.indexOf('existing') < menu.indexOf('chart_runtime'))
    assert.ok(menu.indexOf('chart_runtime') < menu.indexOf('如果用户的问题不需要使用技能'))
  })
})
