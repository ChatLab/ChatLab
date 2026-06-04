import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getTitleBarOverlayOptionsForColor, getTitleBarOverlayOptions } from './window-titlebar'

describe('Windows title bar overlay options', () => {
  it('keeps the native overlay background transparent in normal mode', () => {
    assert.deepEqual(getTitleBarOverlayOptions(false), {
      color: 'rgba(0, 0, 0, 0)',
      symbolColor: '#52525b',
      height: 32,
    })
    assert.deepEqual(getTitleBarOverlayOptions(true), {
      color: 'rgba(0, 0, 0, 0)',
      symbolColor: '#d4d4d8',
      height: 32,
    })
  })

  it('uses readable symbols for sampled custom colors', () => {
    assert.deepEqual(getTitleBarOverlayOptionsForColor('#ffffff'), {
      color: 'rgba(0, 0, 0, 0)',
      symbolColor: '#3f3f46',
      height: 32,
    })
    assert.deepEqual(getTitleBarOverlayOptionsForColor('#111827'), {
      color: 'rgba(0, 0, 0, 0)',
      symbolColor: '#e4e4e7',
      height: 32,
    })
  })
})
