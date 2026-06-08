import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

describe('ChatMessage plan validation rendering', () => {
  it('does not render a manual step number inside the ordered validation list', () => {
    const source = readFileSync(new URL('./ChatMessage.vue', import.meta.url), 'utf8')
    const validationSection = source.slice(
      source.indexOf("block.tag === 'plan_validation'"),
      source.indexOf('<!-- 技能块 -->')
    )

    assert.ok(validationSection.includes('<ol'), 'expected plan validation steps to render in an ordered list')
    assert.equal(
      validationSection.includes('{{ stepIndex + 1 }}.'),
      false,
      'ordered lists already render step numbers, so the template must not add another number'
    )
  })
})
