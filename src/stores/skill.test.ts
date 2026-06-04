import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { CHART_CAPABILITY_SKILL_ID } from '@openchatlab/core'
import { useSkillStore, type SkillSummary } from './skill'

const localSkill: SkillSummary = {
  id: 'local_summary',
  name: 'Local Summary',
  description: 'Summarize the current chat',
  tags: ['summary'],
  chatScope: 'all',
  tools: [],
}

describe('skill store chart capability', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('exposes chart capability as a compatible slash skill without import', () => {
    const store = useSkillStore()
    store.skills = [localSkill]
    store.setFilterContext('group', 'en-US')

    const ids = store.compatibleSkills.map((skill) => skill.id)
    assert.equal(ids[0], CHART_CAPABILITY_SKILL_ID)
    assert.ok(ids.includes(localSkill.id))
    assert.equal(store.compatibleSkills[0].name, 'Chart Assistant')
  })

  it('activates and clears the chart capability through the same single-message toggle', async () => {
    const store = useSkillStore()
    store.setFilterContext('group', 'zh-CN')

    store.activateSkill(CHART_CAPABILITY_SKILL_ID)
    assert.equal(store.activeSkillId, CHART_CAPABILITY_SKILL_ID)
    assert.equal(store.activeSkill?.name, '绘图助手')

    const config = await store.getSkillConfig(CHART_CAPABILITY_SKILL_ID)
    assert.equal(config?.id, CHART_CAPABILITY_SKILL_ID)
    assert.deepEqual(config?.tools, ['render_chart', 'get_schema'])
    assert.equal(config?.prompt, '')

    store.activateSkill(null)
    assert.equal(store.activeSkillId, null)
    assert.equal(store.activeSkill, null)
  })
})
