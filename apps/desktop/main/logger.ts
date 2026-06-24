/**
 * General app logger (Electron main).
 *
 * Thin wrapper over the shared node-runtime appLogger so all runtimes write to
 * the same rolling `logs/app.log`. Exported shape kept for existing call sites.
 */

import { initAppLogger, appLogger } from '@openchatlab/node-runtime'
import { getLogsDir } from './paths'

let initialized = false

function ensureInit(): void {
  if (initialized) return
  initialized = true
  initAppLogger(getLogsDir())
}

export const logger = {
  info: (message: string) => {
    ensureInit()
    appLogger.info('app', message)
  },
  warn: (message: string) => {
    ensureInit()
    appLogger.warn('app', message)
  },
  error: (message: string) => {
    ensureInit()
    appLogger.error('app', message)
  },
  debug: (message: string) => {
    ensureInit()
    appLogger.debug('app', message)
  },
}
