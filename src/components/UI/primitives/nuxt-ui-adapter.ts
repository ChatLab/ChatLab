import type { UiTone } from './types'

type NuxtUiColor = 'primary' | 'neutral' | 'success' | 'warning' | 'error' | 'info'

const NUXT_UI_COLOR_BY_TONE: Record<UiTone, NuxtUiColor> = {
  primary: 'primary',
  neutral: 'neutral',
  success: 'success',
  warning: 'warning',
  danger: 'error',
  info: 'info',
}

export function toNuxtUiColor(tone: UiTone): NuxtUiColor {
  return NUXT_UI_COLOR_BY_TONE[tone]
}
