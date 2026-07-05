/**
 * Startup observability for the optional Rust parsing kernels.
 *
 * Desktop main process and CLI entry points call this once at startup so
 * `logs/app.log` always records whether imports will use the native kernels
 * or the pure-TS fallback (and why). No user data is ever logged here.
 */

import { getNativeParserStatus } from '@openchatlab/parser'
import { appLogger } from '../logging/app-logger'

let logged = false

/** Log once per process whether the Rust native parser kernels can load. */
export function logNativeParserStatus(): void {
  if (logged) return
  logged = true

  const status = getNativeParserStatus()
  if (status.available) {
    appLogger.info('import', 'Native parser kernels available (Rust module loaded)')
  } else if (status.disabled) {
    appLogger.info('import', 'Native parser kernels disabled via CHATLAB_DISABLE_NATIVE_PERF=1; using TS parsers')
  } else {
    appLogger.warn('import', 'Native parser kernels unavailable; imports fall back to TS parsers', {
      reason: status.error ?? 'unknown',
    })
  }
}
