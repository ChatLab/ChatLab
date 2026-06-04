import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createActivateSkillTool } from '../activate-skill-tool'
import type { SkillDef } from '../types'

const TOOL_SKILL: SkillDef = {
  id: 'tool_skill',
  name: 'Tool Skill',
  description: 'Requires an analysis tool',
  tags: ['test'],
  chatScope: 'all',
  tools: ['keyword_frequency'],
  prompt: 'Use keyword frequency.',
}

describe('createActivateSkillTool', () => {
  it('rejects a skill when an empty allowedTools list omits required tools', async () => {
    const tool = createActivateSkillTool({
      chatType: 'group',
      allowedTools: [],
      getSkillConfig: () => TOOL_SKILL,
    })

    const result = await tool.execute('call_1', { skill_id: 'tool_skill' })

    assert.equal(result.details.applicable, false)
    assert.deepEqual(result.details.missingTools, ['keyword_frequency'])
  })

  it('allows core tool requirements even when no analysis tools are allowed', async () => {
    const tool = createActivateSkillTool({
      chatType: 'group',
      allowedTools: [],
      coreToolNames: new Set(['get_schema']),
      getSkillConfig: () => ({ ...TOOL_SKILL, tools: ['get_schema'] }),
    })

    const result = await tool.execute('call_1', { skill_id: 'tool_skill' })

    assert.equal(result.details.applicable, true)
  })
})
