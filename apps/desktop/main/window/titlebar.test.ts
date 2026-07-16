import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { BrowserWindow, TitleBarOverlayOptions } from 'electron'
import {
  applyCurrentTitleBarOverlay,
  applyTitleBarOverlayColor,
  getTitleBarOverlayOptionsForColor,
  getTitleBarOverlayOptions,
  resetCurrentTitleBarOverlayColor,
} from './titlebar'

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

  it('can drop a sampled color when the effective theme changes', () => {
    const calls: TitleBarOverlayOptions[] = []
    const win = {
      setTitleBarOverlay: (options: TitleBarOverlayOptions) => {
        calls.push(options)
      },
    } as Pick<BrowserWindow, 'setTitleBarOverlay'> as BrowserWindow

    applyTitleBarOverlayColor(win, '#111827')
    resetCurrentTitleBarOverlayColor()
    applyCurrentTitleBarOverlay(win, false)

    assert.deepEqual(calls.at(-1), {
      color: 'rgba(0, 0, 0, 0)',
      symbolColor: '#52525b',
      height: 32,
    })
  })
})
