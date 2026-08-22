import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveMentionMenuKeyboardAction } from './mention-menu-keyboard'

test('lets IME composition keys reach the editor while preserving mention keyboard navigation', () => {
  const cases = [
    { key: 'Enter', isComposing: true, hasKeyboardSelection: false, expected: 'pass' },
    { key: 'ArrowDown', isComposing: true, hasKeyboardSelection: false, expected: 'pass' },
    { key: 'Enter', isComposing: false, hasKeyboardSelection: false, expected: 'block' },
    { key: 'Tab', isComposing: false, hasKeyboardSelection: false, expected: 'block' },
    { key: 'ArrowDown', isComposing: false, hasKeyboardSelection: false, expected: 'activate-and-block' },
    { key: 'ArrowUp', isComposing: false, hasKeyboardSelection: false, expected: 'activate' },
    { key: 'Enter', isComposing: false, hasKeyboardSelection: true, expected: 'pass' },
  ] as const

  for (const { expected, ...params } of cases) {
    assert.equal(resolveMentionMenuKeyboardAction(params), expected, JSON.stringify(params))
  }
})
