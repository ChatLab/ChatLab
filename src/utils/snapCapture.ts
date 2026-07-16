import { snapdom, type CaptureResult, type SnapdomOptions } from '@zumer/snapdom'

export interface CaptureOptions {
  maxExportWidth?: number
  minScale?: number
  backgroundColor?: string
  crossOrigin?: string
  embedFonts?: boolean
  filename?: string
  /** 是否捕获完整的可滚动内容（默认 true） */
  fullContent?: boolean
}

interface RgbaColor {
  r: number
  g: number
  b: number
  a: number
}

const colorProbeCanvas = document.createElement('canvas')
colorProbeCanvas.width = 1
colorProbeCanvas.height = 1
const colorProbeCtx = colorProbeCanvas.getContext('2d', { willReadFrequently: true })

function parseCssColorToRgba(color: string): RgbaColor | null {
  if (!colorProbeCtx) return null

  const ctx = colorProbeCtx
  ctx.clearRect(0, 0, 1, 1)

  // 先写入完全透明作为基底，确保读取到 alpha 信息。
  ctx.fillStyle = 'rgba(0, 0, 0, 0)'
  ctx.fillRect(0, 0, 1, 1)

  try {
    ctx.fillStyle = color
  } catch {
    return null
  }

  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
  if (a === 0) return null

  return {
    r,
    g,
    b,
    a: a / 255,
  }
}

function compositeOver(top: RgbaColor, bottom: RgbaColor): RgbaColor {
  const alpha = top.a + bottom.a * (1 - top.a)
  if (alpha <= 0) {
    return { r: 0, g: 0, b: 0, a: 0 }
  }

  return {
    r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / alpha,
    g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / alpha,
    b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / alpha,
    a: alpha,
  }
}

function toOpaqueRgbString(color: RgbaColor): string {
  return `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`
}

function getEffectiveBackground(el: HTMLElement | null): string {
  const fallbackBackground: RgbaColor = { r: 17, g: 17, b: 17, a: 1 }

  let node: HTMLElement | null = el
  let blended: RgbaColor | null = null

  while (node) {
    const bg = window.getComputedStyle(node).backgroundColor
    const parsed = parseCssColorToRgba(bg)
    if (parsed && parsed.a > 0) {
      blended = blended ? compositeOver(blended, parsed) : parsed
      if (blended.a >= 0.999) {
        return toOpaqueRgbString(blended)
      }
    }
    node = node.parentElement
  }

  if (!blended) {
    return toOpaqueRgbString(fallbackBackground)
  }

  return toOpaqueRgbString(compositeOver(blended, fallbackBackground))
}

function triggerDownload(href: string, filename: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
      } else {
        reject(new Error('Canvas PNG encoding returned an empty result'))
      }
    }, 'image/png')
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Failed to serialize captured image'))
    reader.readAsDataURL(blob)
  })
}

async function renderCaptureToBlob(
  result: CaptureResult,
  maxExportWidth: number,
  backgroundColor: string
): Promise<Blob> {
  const sourceCanvas = await result.toCanvas()
  let exportCanvas = sourceCanvas

  // 大部分截图无需缩放，直接复用 SnapDOM 的 Canvas，避免一次全尺寸绘制和内存分配。
  if (sourceCanvas.width > maxExportWidth) {
    const scale = maxExportWidth / sourceCanvas.width
    const resizedCanvas = document.createElement('canvas')
    resizedCanvas.width = Math.round(sourceCanvas.width * scale)
    resizedCanvas.height = Math.round(sourceCanvas.height * scale)
    const context = resizedCanvas.getContext('2d')
    if (!context) throw new Error('Failed to create capture resize context')

    context.fillStyle = backgroundColor
    context.fillRect(0, 0, resizedCanvas.width, resizedCanvas.height)
    context.drawImage(sourceCanvas, 0, 0, resizedCanvas.width, resizedCanvas.height)
    exportCanvas = resizedCanvas
  }
  return canvasToPngBlob(exportCanvas)
}

/**
 * 捕获元素为图片数据，返回 base64 字符串
 * @param rootEl 要捕获的 DOM 元素
 * @param options 捕获选项
 * @returns Promise<string> 图片的 data URL (base64)
 */
export async function captureAsImageData(rootEl: HTMLElement, options?: CaptureOptions): Promise<string> {
  // 提高默认清晰度：maxExportWidth 2160（2K），minScale 1（不缩小）
  const maxExportWidth = options?.maxExportWidth ?? 2160
  const minScale = options?.minScale ?? 1
  const fullContent = options?.fullContent !== false // 默认为 true

  // 获取元素的实际背景色（优先用户指定，否则自动检测）
  const bgColor = options?.backgroundColor ?? getEffectiveBackground(rootEl)

  // 计算元素尺寸：如果需要完整内容，使用 scrollWidth/scrollHeight
  const elementWidth = fullContent ? rootEl.scrollWidth : rootEl.getBoundingClientRect().width
  let captureScale = Math.min(1, maxExportWidth / Math.max(1, elementWidth))
  captureScale = Math.max(minScale, captureScale)

  const snapOptions: SnapdomOptions = {
    scale: captureScale,
    // 禁用字体嵌入可以避免某些 Unicode 字符导致的 encodeURIComponent 错误
    embedFonts: options?.embedFonts ?? false,
    backgroundColor: bgColor,
  }

  const result = await snapdom(rootEl, snapOptions)

  // 首选 Canvas + 异步 Blob 编码，避免 toDataURL 同步阻塞渲染线程。
  try {
    const blob = await renderCaptureToBlob(result, maxExportWidth, bgColor)
    return blobToDataUrl(blob)
  } catch {
    // fallback below
  }

  // Fallback: use SnapDOM's Blob exporter while retaining asynchronous PNG encoding.
  try {
    const blob = await result.toBlob({ type: 'png', backgroundColor: bgColor })
    return blobToDataUrl(blob)
  } catch {
    // swallow
  }

  // Last fallback: convert SnapDOM's PNG image result back into a Blob.
  try {
    const image = await result.toPng({ backgroundColor: bgColor })
    const response = await fetch(image.src)
    const blob = await response.blob()
    return blobToDataUrl(blob)
  } catch (e) {
    console.error('captureAsImageData: all export paths failed', e)
    throw new Error('Failed to capture image data')
  }
}

export async function captureAndDownloadPng(rootEl: HTMLElement, options?: CaptureOptions): Promise<void> {
  try {
    const dataUrl = await captureAsImageData(rootEl, options)
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    triggerDownload(dataUrl, options?.filename ?? `wlb-report-${ts}.png`)
  } catch (e) {
    console.error('captureAndDownloadPng: all export paths failed', e)
  }
}
