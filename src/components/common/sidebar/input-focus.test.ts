import assert from 'node:assert/strict'
import test from 'node:test'
import { focusExposedInput } from './input-focus'

test('focuses and selects the native input exposed by UInput', () => {
  const calls: string[] = []

  assert.equal(
    focusExposedInput(
      {
        inputRef: {
          focus: () => calls.push('focus'),
          select: () => calls.push('select'),
        },
      },
      { select: true }
    ),
    true
  )
  assert.deepEqual(calls, ['focus', 'select'])
})

test('does nothing before the native input is mounted', () => {
  assert.equal(focusExposedInput(null), false)
  assert.equal(focusExposedInput({ inputRef: null }), false)
})
