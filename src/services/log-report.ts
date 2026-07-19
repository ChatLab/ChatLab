/**
 * Front-end error reporter.
 *
 * The browser can't write log files, so uncaught front-end errors are sent to
 * the backend (POST /_web/logs/report) and appended to logs/app.log (scope
 * 'web'). Error-level only; deduped + throttled to avoid error storms.
 */

import { post } from './utils/http'
import { IS_WEB_WASM } from '@/utils/platform'

export interface FrontendRuntimeLogEvent {
  level: 'debug' | 'info' | 'error'
  scope: string
  message: string
  data?: Record<string, unknown>
}

const recent = new Map<string, number>()
const DEDUP_WINDOW_MS = 10_000

function shouldReport(key: string): boolean {
  const now = Date.now()
  const last = recent.get(key)
  if (last !== undefined && now - last < DEDUP_WINDOW_MS) return false
  recent.set(key, now)
  // Bound the map so it can't grow without limit.
  if (recent.size > 100) {
    for (const [k, t] of recent) {
      if (now - t >= DEDUP_WINDOW_MS) recent.delete(k)
    }
  }
  return true
}

export function reportError(message: string, stack?: string): void {
  if (!message) return
  const key = `${message}::${stack?.split('\n')[1] ?? ''}`
  if (!shouldReport(key)) return
  if (IS_WEB_WASM) return
  // Fire-and-forget; never let reporting throw or block the UI.
  void post('/logs/report', {
    level: 'error',
    message,
    stack,
    url: typeof location !== 'undefined' ? location.href : undefined,
  }).catch(() => {})
}

export function reportRuntimeLog(event: FrontendRuntimeLogEvent): void {
  const method = event.level === 'error' ? console.error : event.level === 'debug' ? console.debug : console.info
  method(`[${event.scope}] ${event.message}`, event.data ?? '')
  if (event.level === 'error') {
    reportError(`[${event.scope}] ${event.message}${event.data ? ` ${JSON.stringify(event.data)}` : ''}`)
  }
}

/** Install global handlers. Call once at app startup. */
export function installGlobalErrorReporting(): void {
  window.addEventListener('error', (e) => {
    reportError(e.message || String(e.error), e.error?.stack)
  })
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason
    reportError(
      reason instanceof Error ? reason.message : `Unhandled rejection: ${String(reason)}`,
      reason instanceof Error ? reason.stack : undefined
    )
  })
}
