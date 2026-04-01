import { snapdom } from '@zumer/snapdom'

export interface CaptureOptions {
  maxExportWidth?: number
  minScale?: number
  backgroundColor?: string
  crossOrigin?: string
  embedFonts?: boolean
  compress?: boolean
  filename?: string
  /** 是否捕获完整的可滚动内容（默认 true） */
  fullContent?: boolean
}

function getEffectiveBackground(el: HTMLElement | null): string {
  let node: HTMLElement | null = el
  const isTransparent = (v: string) => !v || v === 'transparent' || v === 'rgba(0, 0, 0, 0)'
  while (node && node !== document.documentElement) {
    const bg = window.getComputedStyle(node).backgroundColor
    if (!isTransparent(bg)) return bg
    node = node.parentElement
  }
  const bodyBg = window.getComputedStyle(document.body).backgroundColor
  return isTransparent(bodyBg) ? '#111111' : bodyBg
}

function triggerDownload(href: string, filename: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
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

  const snapOptions: Record<string, unknown> = {
    scale: captureScale,
    // 禁用字体嵌入可以避免某些 Unicode 字符导致的 encodeURIComponent 错误
    embedFonts: options?.embedFonts ?? false,
    compress: options?.compress ?? true,
    backgroundColor: bgColor,
    crossOrigin: options?.crossOrigin ?? 'anonymous',
  }

  const result = await (
    snapdom as (
      element: Element,
      options: Record<string, unknown>
    ) => Promise<{
      toCanvas: () => Promise<unknown>
      toPng: (options?: Record<string, unknown>) => Promise<unknown>
      toImg: () => Promise<HTMLImageElement>
    }>
  )(rootEl, snapOptions)

  // Preferred: Canvas path, apply background and scale again if needed, return data URL
  try {
    const canvas: unknown = await result.toCanvas()
    if (canvas && (canvas as HTMLCanvasElement).toDataURL) {
      const srcCanvas = canvas as HTMLCanvasElement
      const outCanvas = document.createElement('canvas')
      const scale2 = srcCanvas.width > maxExportWidth ? maxExportWidth / srcCanvas.width : 1
      outCanvas.width = Math.round(srcCanvas.width * scale2)
      outCanvas.height = Math.round(srcCanvas.height * scale2)
      const ctx = outCanvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = bgColor
        ctx.fillRect(0, 0, outCanvas.width, outCanvas.height)
        ctx.drawImage(srcCanvas, 0, 0, outCanvas.width, outCanvas.height)
        return outCanvas.toDataURL('image/png')
      }
    }
  } catch {
    // fallback below
  }

  // Fallback: direct PNG export with background
  try {
    const png: unknown = await result.toPng({ backgroundColor: bgColor })

    if (png instanceof HTMLImageElement) {
      return png.src
    }
    if (png instanceof Blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(png)
      })
    }
    if (typeof png === 'string') {
      return png
    }
  } catch {
    // swallow
  }

  // Last Fallback: toImg
  try {
    const img: HTMLImageElement = await result.toImg()
    return img.src
  } catch (e) {
    console.error('captureAsImageData: all export paths failed', e)
    throw new Error('Failed to capture image data')
  }
}

export async function captureAndDownloadPng(rootEl: HTMLElement, options?: CaptureOptions): Promise<void> {
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

  const snapOptions: Record<string, unknown> = {
    scale: captureScale,
    // 禁用字体嵌入可以避免某些 Unicode 字符导致的 encodeURIComponent 错误
    embedFonts: options?.embedFonts ?? false,
    compress: options?.compress ?? true,
    backgroundColor: bgColor,
    crossOrigin: options?.crossOrigin ?? 'anonymous',
  }

  const result = await (
    snapdom as (
      element: Element,
      options: Record<string, unknown>
    ) => Promise<{
      toCanvas: () => Promise<unknown>
      toPng: (options?: Record<string, unknown>) => Promise<unknown>
      toImg: () => Promise<HTMLImageElement>
    }>
  )(rootEl, snapOptions)

  // Preferred: Canvas path, apply background and scale again if needed, export PNG
  try {
    const canvas: unknown = await result.toCanvas()
    if (canvas && (canvas as HTMLCanvasElement).toDataURL) {
      const srcCanvas = canvas as HTMLCanvasElement
      const outCanvas = document.createElement('canvas')
      const scale2 = srcCanvas.width > maxExportWidth ? maxExportWidth / srcCanvas.width : 1
      outCanvas.width = Math.round(srcCanvas.width * scale2)
      outCanvas.height = Math.round(srcCanvas.height * scale2)
      const ctx = outCanvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = bgColor
        ctx.fillRect(0, 0, outCanvas.width, outCanvas.height)
        ctx.drawImage(srcCanvas, 0, 0, outCanvas.width, outCanvas.height)
        const url = outCanvas.toDataURL('image/png')
        const ts = new Date().toISOString().replace(/[:.]/g, '-')
        triggerDownload(url, options?.filename ?? `wlb-report-${ts}.png`)
        return
      }
    }
  } catch {
    // fallback below
  }

  // Fallback: direct PNG export with background
  try {
    const png: unknown = await result.toPng({ backgroundColor: bgColor })
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const name = options?.filename ?? `wlb-report-${ts}.png`

    if (png instanceof HTMLImageElement) {
      triggerDownload(png.src, name)
      return
    }
    if (png instanceof Blob) {
      const url = URL.createObjectURL(png)
      triggerDownload(url, name)
      URL.revokeObjectURL(url)
      return
    }
    if (typeof png === 'string') {
      triggerDownload(png, name)
      return
    }
  } catch {
    // swallow
  }

  // Last Fallback: toImg
  try {
    const img: HTMLImageElement = await result.toImg()
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    triggerDownload(img.src, options?.filename ?? `wlb-report-${ts}.png`)
  } catch (e) {
    // As a last resort, do nothing but log
    console.error('captureAndDownloadPng: all export paths failed', e)
  }
}
