/**
 * 用户活动追踪 Composable
 *
 * 监听全局鼠标、键盘和触摸事件，定期向主进程报告用户活动，
 * 用于应用锁的闲置超时检测。
 *
 * 安全设计：
 * - 仅报告"有活动发生"这一事实，不传输任何具体事件数据
 * - 使用 5 秒节流避免 IPC 频率过高
 * - 挂载时自动开始追踪，卸载时自动停止
 */

import { onMounted, onUnmounted } from 'vue'

/** 活动事件类型 */
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll', 'mousemove'] as const

/** 节流间隔 (ms) */
const THROTTLE_MS = 5000

let isTracking = false
let lastReportTime = 0
let throttleTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 向主进程报告用户活动（带节流）
 */
function reportActivity() {
  const now = Date.now()

  // 节流：5 秒内最多报告一次
  if (now - lastReportTime < THROTTLE_MS) {
    if (!throttleTimer) {
      throttleTimer = setTimeout(() => {
        throttleTimer = null
        doReport()
      }, THROTTLE_MS - (now - lastReportTime))
    }
    return
  }

  doReport()
}

function doReport() {
  lastReportTime = Date.now()
  try {
    window.securityApi?.reportActivity()
  } catch {
    // 静默失败，活动追踪不应影响用户体验
  }
}

/**
 * 启动用户活动追踪
 *
 * 在 App.vue onMounted 中调用。
 * 监听全局用户交互事件，节流向主进程报告。
 */
export function useActivityTracker() {
  function start() {
    if (isTracking) return
    isTracking = true

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, reportActivity, { passive: true })
    }
  }

  function stop() {
    if (!isTracking) return
    isTracking = false

    for (const event of ACTIVITY_EVENTS) {
      window.removeEventListener(event, reportActivity)
    }

    if (throttleTimer) {
      clearTimeout(throttleTimer)
      throttleTimer = null
    }
  }

  onMounted(() => {
    start()
  })

  onUnmounted(() => {
    stop()
  })

  return { start, stop }
}
