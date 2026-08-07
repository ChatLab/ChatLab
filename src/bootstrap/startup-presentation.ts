export const STARTUP_ANIMATION_DURATION_MS = 1_800

export interface StartupPresentationInput {
  runtimeReady: boolean
  animationComplete: boolean
  initializationFailed: boolean
}

export interface StartupPresentation {
  mountShell: boolean
  showCover: boolean
  showError: boolean
  showWaitingIndicator: boolean
}

/**
 * 启动动画只控制呈现时机，不阻塞壳层预热和非关键后台任务。
 * 初始化失败时始终优先展示错误，避免为了品牌动画延迟可恢复操作。
 */
export function resolveStartupPresentation(input: StartupPresentationInput): StartupPresentation {
  if (input.initializationFailed) {
    return {
      mountShell: false,
      showCover: true,
      showError: true,
      showWaitingIndicator: false,
    }
  }

  return {
    mountShell: input.runtimeReady,
    showCover: !input.runtimeReady || !input.animationComplete,
    showError: false,
    showWaitingIndicator: input.animationComplete && !input.runtimeReady,
  }
}
