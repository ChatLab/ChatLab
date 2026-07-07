/**
 * Import performance logger — Electron adapter.
 *
 * Delegates to @openchatlab/node-runtime perf logger.
 * Provides the log directory from Electron's path system.
 */

import { initPerfLog as coreInitPerfLog } from '@openchatlab/node-runtime'
import { getLogsDir } from './dbCore'
import { getImportLogDir } from './perfLogPath'

export {
  LogLevel,
  logPerf,
  logPerfDetail,
  resetPerfLog,
  getCurrentLogFile,
  logError,
  logInfo,
  getErrorCount,
  logSummary,
} from '@openchatlab/node-runtime'

export function initPerfLog(sessionId: string): void {
  const logsDir = getLogsDir()
  const logDir = logsDir ? getImportLogDir(logsDir) : ''
  coreInitPerfLog(sessionId, logDir)
}
