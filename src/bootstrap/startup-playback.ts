export const STARTUP_PRESENTATION_SESSION_KEY = 'chatlab:startup-presentation-shown:v1'

type StartupPlaybackStorage = Pick<Storage, 'getItem' | 'setItem'>

/**
 * 为当前窗口或标签页认领一次完整启动展示。
 * sessionStorage 在刷新后保留、关闭浏览上下文后清除，正好对应一次应用浏览会话。
 */
export function claimFullStartupPresentation(storage: StartupPlaybackStorage = sessionStorage): boolean {
  try {
    if (storage.getItem(STARTUP_PRESENTATION_SESSION_KEY) !== null) return false
    storage.setItem(STARTUP_PRESENTATION_SESSION_KEY, '1')
    return true
  } catch {
    // 存储不可用时保留完整启动，避免异常环境绕过既有呈现状态机。
    return true
  }
}
