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
