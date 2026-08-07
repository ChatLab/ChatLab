import { nextTick, onMounted, onUnmounted, watch, type WatchSource } from 'vue'
import { IS_ELECTRON } from '@/utils/platform'

interface RgbaColor {
  r: number
  g: number
  b: number
  a: number
}

interface WindowControlsOverlayLike extends EventTarget {
  visible: boolean
  getTitlebarAreaRect(): DOMRect
}

const TRANSITION_SAMPLE_MS = 420

export function useWindowsTitleBarOverlay(triggers: WatchSource<unknown>[]): void {
  if (!IS_ELECTRON || typeof navigator === 'undefined' || !navigator.platform.toLowerCase().includes('win')) return

  let frameId = 0
  let lastColor = ''
  const windowControlsOverlay = getWindowControlsOverlay()

  const syncTitleBarColor = () => {
    const color = sampleTitleBarBackground()
    if (!color || color === lastColor) return

    lastColor = color
    window.api?.setTitleBarOverlayColor(color)
  }

  const scheduleSync = (durationMs = 0) => {
    if (frameId) {
      cancelAnimationFrame(frameId)
    }

    const startedAt = performance.now()
    const tick = () => {
      syncTitleBarColor()
      if (performance.now() - startedAt < durationMs) {
        frameId = requestAnimationFrame(tick)
      } else {
        frameId = 0
      }
    }

    nextTick(() => {
      frameId = requestAnimationFrame(tick)
    })
  }

  const handleResize = () => scheduleSync()

  onMounted(() => {
    window.addEventListener('resize', handleResize)
    windowControlsOverlay?.addEventListener('geometrychange', handleResize)
    scheduleSync(TRANSITION_SAMPLE_MS)
  })

  onUnmounted(() => {
    window.removeEventListener('resize', handleResize)
    windowControlsOverlay?.removeEventListener('geometrychange', handleResize)
    if (frameId) {
      cancelAnimationFrame(frameId)
    }
  })

  for (const trigger of triggers) {
    watch(trigger, () => scheduleSync(TRANSITION_SAMPLE_MS), { flush: 'post' })
  }
}

// 采样 Windows 标题栏按钮区域下方的真实背景色，并用它推导原生按钮符号和 hover 颜色。
// 这里需要沿 elementsFromPoint 返回的层级合成透明背景，才能覆盖设置弹窗淡入淡出时的 blur/backdrop 场景。
function sampleTitleBarBackground(): string | null {
  const samplePoint = getTitleBarSamplePoint()
  if (!samplePoint) return null

  const { x, y } = samplePoint
  const elements = document.elementsFromPoint(x, y)
  if (elements.length === 0) return null

  let color = getPageFallbackColor()
  for (const element of [...elements].reverse()) {
    const style = window.getComputedStyle(element)
    const background = parseCssColor(style.backgroundColor)
    if (!background || background.a <= 0) continue

    const opacity = Number.parseFloat(style.opacity)
    const effectiveAlpha = background.a * (Number.isFinite(opacity) ? opacity : 1)
    color = composite({ ...background, a: effectiveAlpha }, color)
  }

  return rgbaToHex(color)
}

function getWindowControlsOverlay(): WindowControlsOverlayLike | undefined {
  return (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlayLike }).windowControlsOverlay
}

function getTitleBarSamplePoint(): { x: number; y: number } | null {
  const overlay = getWindowControlsOverlay()
  if (!overlay?.visible) return null

  const titleBarArea = overlay.getTitlebarAreaRect()
  if (titleBarArea.width <= 0 || titleBarArea.height <= 0 || window.innerWidth <= 0) return null

  const leftControlsWidth = Math.max(0, titleBarArea.x)
  const rightControlsStart = titleBarArea.x + titleBarArea.width
  const rightControlsWidth = Math.max(0, window.innerWidth - rightControlsStart)

  let x: number
  if (rightControlsWidth > 0) {
    x = rightControlsStart + rightControlsWidth / 2
  } else if (leftControlsWidth > 0) {
    x = leftControlsWidth / 2
  } else {
    return null
  }

  return {
    x: Math.min(window.innerWidth - 1, Math.max(0, x)),
    y: Math.max(0, titleBarArea.y + titleBarArea.height / 2),
  }
}

function getPageFallbackColor(): RgbaColor {
  const rootColor = parseCssColor(window.getComputedStyle(document.documentElement).backgroundColor)
  if (rootColor && rootColor.a > 0) return rootColor

  const bodyColor = parseCssColor(window.getComputedStyle(document.body).backgroundColor)
  if (bodyColor && bodyColor.a > 0) return bodyColor

  return document.documentElement.classList.contains('dark')
    ? { r: 17, g: 24, b: 39, a: 1 }
    : { r: 255, g: 255, b: 255, a: 1 }
}

function parseCssColor(raw: string): RgbaColor | null {
  if (!raw || raw === 'transparent') return null

  const rgbMatch = /^rgba?\(([^)]+)\)$/.exec(raw)
  if (!rgbMatch) return null

  const colorBody = rgbMatch[1].trim()
  const parts = colorBody.includes(',')
    ? colorBody.split(',').map((part) => part.trim())
    : colorBody.replace('/', ' ').split(/\s+/).filter(Boolean)
  if (parts.length < 3) return null

  const r = parseColorChannel(parts[0])
  const g = parseColorChannel(parts[1])
  const b = parseColorChannel(parts[2])
  const a = parts[3] === undefined ? 1 : parseAlphaChannel(parts[3])
  if (![r, g, b, a].every(Number.isFinite)) return null

  return {
    r: clampColor(r),
    g: clampColor(g),
    b: clampColor(b),
    a: Math.min(1, Math.max(0, a)),
  }
}

function parseColorChannel(raw: string): number {
  if (raw.endsWith('%')) {
    return (Number.parseFloat(raw) / 100) * 255
  }

  return Number.parseFloat(raw)
}

function parseAlphaChannel(raw: string): number {
  if (raw.endsWith('%')) {
    return Number.parseFloat(raw) / 100
  }

  return Number.parseFloat(raw)
}

function composite(top: RgbaColor, bottom: RgbaColor): RgbaColor {
  const alpha = top.a + bottom.a * (1 - top.a)
  if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 }

  return {
    r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / alpha,
    g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / alpha,
    b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / alpha,
    a: alpha,
  }
}

function rgbaToHex(color: RgbaColor): string {
  const r = clampColor(color.r).toString(16).padStart(2, '0')
  const g = clampColor(color.g).toString(16).padStart(2, '0')
  const b = clampColor(color.b).toString(16).padStart(2, '0')
  return `#${r}${g}${b}`
}

function clampColor(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)))
}
