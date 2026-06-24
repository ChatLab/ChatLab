/**
 * ChatLab API logger (Electron main).
 *
 * Delegates to the shared appLogger with scope 'api', written into the unified
 * logs/app.log. Exported shape kept for existing call sites.
 */

import { initAppLogger, appLogger } from '@openchatlab/node-runtime'
import { getLogsDir } from '../paths'

let initialized = false

function ensureInit(): void {
  if (initialized) return
  initialized = true
  initAppLogger(getLogsDir())
}

export const apiLogger = {
  info: (msg: string, detail?: unknown) => {
    ensureInit()
    appLogger.info('api', msg, detail)
  },
  warn: (msg: string, detail?: unknown) => {
    ensureInit()
    appLogger.warn('api', msg, detail)
  },
  error: (msg: string, detail?: unknown) => {
    ensureInit()
    appLogger.error('api', msg, detail)
  },
}
