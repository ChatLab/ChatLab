interface CaptureLayoutStabilizationOptions {
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

  // 截图前会临时修改 padding/overflow，先等一次布局完成，再通知 ECharts 按新容器宽度重绘。
  await waitFrame()
  dispatchResize()
  await waitFrame()
}
