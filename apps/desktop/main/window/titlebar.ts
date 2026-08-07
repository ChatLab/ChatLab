import type { BrowserWindow, TitleBarOverlayOptions } from 'electron'

let currentTitleBarOverlayColor: string | null = null

const TITLE_BAR_OVERLAY_PALETTE = {
  light: { backgroundColor: '#f9fafb', symbolColor: '#52525b' },
  dark: { backgroundColor: '#111827', symbolColor: '#d4d4d8' },
} as const

export function getTitleBarOverlayOptions(isDark: boolean): TitleBarOverlayOptions {
  const mode = isDark ? 'dark' : 'light'
  return {
    color: getTransparentOverlayColor(TITLE_BAR_OVERLAY_PALETTE[mode].backgroundColor),
    symbolColor: TITLE_BAR_OVERLAY_PALETTE[mode].symbolColor,
  }
}

export function getTitleBarOverlayOptionsForColor(color: string): TitleBarOverlayOptions {
  return {
    // Electron derives the minimize/maximize hover color from the overlay RGB.
    // Preserve the sampled background channels while keeping the overlay transparent.
    color: getTransparentOverlayColor(color),
    symbolColor: getReadableSymbolColor(color),
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

export function resetCurrentTitleBarOverlayColor(): void {
  currentTitleBarOverlayColor = null
}

function getTransparentOverlayColor(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}00` : 'rgba(0, 0, 0, 0)'
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
