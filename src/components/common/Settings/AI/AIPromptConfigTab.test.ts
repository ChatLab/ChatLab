import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

describe('AIPromptConfigTab tool result budget controls', () => {
  it('allows users to raise tool result budget up to 80 percent', () => {
    const source = readFileSync(new URL('./AIPromptConfigTab.vue', import.meta.url), 'utf8')

    assert.ok(source.includes('Math.min(80, val || 50)'), 'setter should clamp maxToolResultPercent at 80')
    assert.ok(source.includes(':max="80"'), 'number input should allow maxToolResultPercent up to 80')
  })
})
