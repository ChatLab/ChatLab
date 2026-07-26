import assert from 'node:assert/strict'
import { it } from 'node:test'

import { runWithSavingState } from './save-state'

it('resets the saving state when browser persistence rejects', async () => {
  const states: boolean[] = []

  await assert.rejects(
    runWithSavingState(
      (saving) => states.push(saving),
      async () => {
        throw new Error('Browser storage is unavailable')
      }
    ),
    /Browser storage is unavailable/
  )
  assert.deepEqual(states, [true, false])
})
