import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

describe('ChatMessage plan validation rendering', () => {
  it('lets assistant messages fill the available row while keeping user bubbles constrained', () => {
    const source = readFileSync(new URL('./ChatMessage.vue', import.meta.url), 'utf8')

    assert.ok(
      source.includes("isUser && !isEditing ? 'max-w-[85%] min-w-0' : 'w-full min-w-0'"),
      'assistant messages should use full width while user messages keep the existing max width'
    )
  })

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
