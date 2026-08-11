import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { toNuxtUiColor } from './nuxt-ui-adapter'
import {
  assertButtonAccessibleName,
  assertProgressLabel,
  filterPrimitiveAttrs,
  getUiProgressState,
} from './primitive-contracts'
import type { UiTone } from './types'

describe('UI primitive contracts', () => {
  it('maps semantic tones to the current Nuxt UI adapter', () => {
    const cases: Array<[UiTone, ReturnType<typeof toNuxtUiColor>]> = [
      ['primary', 'primary'],
      ['neutral', 'neutral'],
      ['success', 'success'],
      ['warning', 'warning'],
      ['danger', 'error'],
      ['info', 'info'],
    ]

    for (const [tone, expected] of cases) {
      assert.equal(toNuxtUiColor(tone), expected)
    }
  })

  it('keeps stable DOM attributes without exposing vendor component props or listeners', () => {
    const onClick = () => undefined
    assert.deepEqual(
      filterPrimitiveAttrs({
        class: 'custom',
        id: 'action',
        'aria-label': 'Retry',
        'data-test': 'retry',
        ui: { base: 'vendor-override' },
        portal: false,
        onClick,
      }),
      {
        class: 'custom',
        id: 'action',
        'aria-label': 'Retry',
        'data-test': 'retry',
      }
    )
  })

  it('requires every button to have a visible or accessible name', () => {
    assert.doesNotThrow(() => assertButtonAccessibleName({ label: 'Retry', hasDefaultSlot: false }))
    assert.doesNotThrow(() => assertButtonAccessibleName({ accessibleLabel: 'Close', hasDefaultSlot: false }))
    assert.doesNotThrow(() => assertButtonAccessibleName({ hasDefaultSlot: true }))
    assert.throws(
      () => assertButtonAccessibleName({ label: ' ', hasDefaultSlot: false }),
      /visible text or an accessible label/
    )
  })

  it('clamps determinate progress and preserves the indeterminate state', () => {
    assert.deepEqual(getUiProgressState(null, 100), { value: null, percentage: null })
    assert.deepEqual(getUiProgressState(-10, 100), { value: 0, percentage: 0 })
    assert.deepEqual(getUiProgressState(25, 50), { value: 25, percentage: 50 })
    assert.deepEqual(getUiProgressState(120, 100), { value: 100, percentage: 100 })
    assert.throws(() => getUiProgressState(10, 0), /greater than zero/)
  })

  it('requires progress to expose a stable accessible name', () => {
    assert.doesNotThrow(() => assertProgressLabel('Import progress'))
    assert.throws(() => assertProgressLabel(' '), /non-empty accessible label/)
  })
})
