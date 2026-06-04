import type { BrowserWindow, TitleBarOverlayOptions } from 'electron'

const TITLE_BAR_OVERLAY_HEIGHT = 32
const TITLE_BAR_OVERLAY_COLOR = 'rgba(0, 0, 0, 0)'
let currentTitleBarOverlayColor: string | null = null

const TITLE_BAR_OVERLAY_PALETTE = {
  light: { symbolColor: '#52525b' },
  dark: { symbolColor: '#d4d4d8' },
} as const

export function getTitleBarOverlayOptions(isDark: boolean): TitleBarOverlayOptions {
  const mode = isDark ? 'dark' : 'light'
  return {
    color: TITLE_BAR_OVERLAY_COLOR,
    symbolColor: TITLE_BAR_OVERLAY_PALETTE[mode].symbolColor,
    height: TITLE_BAR_OVERLAY_HEIGHT,
  }
}

export function getTitleBarOverlayOptionsForColor(color: string): TitleBarOverlayOptions {
  return {
    color: TITLE_BAR_OVERLAY_COLOR,
    symbolColor: getReadableSymbolColor(color),
    height: TITLE_BAR_OVERLAY_HEIGHT,
  }
}

export function applyCurrentTitleBarOverlay(win: BrowserWindow | null | undefined, isDark: boolean): void {
  if (currentTitleBarOverlayColor) {
    win?.setTitleBarOverlay(getTitleBarOverlayOptionsForColor(currentTitleBarOverlayColor))
    return
  }

  win?.setTitleBarOverlay(getTitleBarOverlayOptions(isDark))
}

export function applyTitleBarOverlayColor(win: BrowserWindow | null | undefined, color: string): void {
  currentTitleBarOverlayColor = color
  win?.setTitleBarOverlay(getTitleBarOverlayOptionsForColor(color))
}

function getReadableSymbolColor(hexColor: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hexColor)
  if (!match) return '#52525b'

  const value = match[1]
  const r = Number.parseInt(value.slice(0, 2), 16) / 255
  const g = Number.parseInt(value.slice(2, 4), 16) / 255
  const b = Number.parseInt(value.slice(4, 6), 16) / 255
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)

  return luminance < 0.45 ? '#e4e4e7' : '#3f3f46'
}

function toLinear(value: number): number {
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}
