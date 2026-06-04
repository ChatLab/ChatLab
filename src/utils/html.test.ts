import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { escapeHtml, escapeRegExp } from './html'

describe('html escaping helpers', () => {
  it('escapes user-provided html before v-html highlighting', () => {
    assert.equal(escapeHtml(`<img src=x onerror="alert(1)">`), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
  })

  it('escapes regex metacharacters in highlight keywords', () => {
    const regex = new RegExp(`(${escapeRegExp('[表情包]')})`, 'gi')

    assert.equal('[表情包]'.replace(regex, '<mark>$1</mark>'), '<mark>[表情包]</mark>')
  })
})
