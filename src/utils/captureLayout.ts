const DEFAULT_NARROWING_BASE_WIDTH = 525
const NARROWING_SCALE_FACTOR = 0.3

interface CapturePaddingStyle {
  paddingTop: string
  paddingRight: string
  paddingBottom: string
  paddingLeft: string
}

interface CapturePaddingSnapshot extends CapturePaddingStyle {
  restoreAll: boolean
}

export function snapshotCapturePadding(style: CapturePaddingStyle, captureFrame: boolean): CapturePaddingSnapshot {
  return {
    paddingTop: style.paddingTop,
    paddingRight: style.paddingRight,
    paddingBottom: style.paddingBottom,
    paddingLeft: style.paddingLeft,
    restoreAll: captureFrame,
  }
}

export function restoreCapturePadding(style: CapturePaddingStyle, snapshot: CapturePaddingSnapshot): void {
  // 普通截图只改动底部水印留白；外框截图覆盖了整个 padding，才需要逐项恢复。
  if (snapshot.restoreAll) {
    style.paddingTop = snapshot.paddingTop
    style.paddingRight = snapshot.paddingRight
    style.paddingLeft = snapshot.paddingLeft
  }
  style.paddingBottom = snapshot.paddingBottom
}

interface CaptureBoxSizingOptions {
  currentWidth: number
  progressiveNarrowing?: number | boolean
  frameHorizontalPadding?: number
}

interface CaptureBoxSizing {
  /** 截图期间留给原内容的宽度 */
  contentWidth: number
  /** 包含截图外框留白的根元素宽度 */
  outerWidth: number
  /** 原内容宽度是否发生变化，用于决定是否通知图表 resize */
  didChangeContentWidth: boolean
}

export function resolveCaptureBoxSizing(options: CaptureBoxSizingOptions): CaptureBoxSizing {
  const { currentWidth, progressiveNarrowing } = options
  let contentWidth = currentWidth

  if (progressiveNarrowing) {
    const baseWidth = typeof progressiveNarrowing === 'number' ? progressiveNarrowing : DEFAULT_NARROWING_BASE_WIDTH

    if (currentWidth > baseWidth) {
      contentWidth = Math.round(baseWidth + (currentWidth - baseWidth) * NARROWING_SCALE_FACTOR)
    }
  }

  const frameHorizontalPadding = Math.max(0, options.frameHorizontalPadding ?? 0)

  return {
    contentWidth,
    outerWidth: contentWidth + frameHorizontalPadding * 2,
    didChangeContentWidth: contentWidth !== currentWidth,
  }
}

interface CaptureLayoutStabilizationOptions {
  /** 仅当截图过程确实改变图表容器宽度时广播 resize */
  resizeCharts?: boolean
  waitFrame?: () => Promise<void>
  dispatchResize?: () => void
}

function waitAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

function dispatchWindowResize() {
  window.dispatchEvent(new Event('resize'))
}

export async function waitForCaptureLayoutStabilization(options?: CaptureLayoutStabilizationOptions): Promise<void> {
  const waitFrame = options?.waitFrame ?? waitAnimationFrame
  const dispatchResize = options?.dispatchResize ?? dispatchWindowResize

  // 始终等待两帧让临时样式稳定；只有宽度变化时才通知 ECharts，避免词云无意义重排。
  await waitFrame()
  if (options?.resizeCharts) {
    dispatchResize()
  }
  await waitFrame()
}
