import assert from 'node:assert/strict'
import test from 'node:test'
import type { DesktopCloseBehavior } from '@openchatlab/shared-types'
import { applyWindowsCloseBehavior } from './close-behavior'

function applyBehavior(preference: DesktopCloseBehavior): string[] {
  const calls: string[] = []

  applyWindowsCloseBehavior({
    readPreference: () => preference,
    enterBackground: () => calls.push('background'),
    quit: () => calls.push('quit'),
    onError: (error) => calls.push(`error:${String(error)}`),
  })

  return calls
}

test('applies the configured Windows close behavior', () => {
  assert.deepEqual(applyBehavior('background'), ['background'])
  assert.deepEqual(applyBehavior('quit'), ['quit'])
})
