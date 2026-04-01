/**
 * 核心基础设施模块入口
 * 统一导出数据库核心工具和性能日志
 */

export {
  initDbDir,
  getDbPath,
  openDatabase,
  closeDatabase,
  closeAllDatabases,
  getDbDir,
  buildTimeFilter,
  buildSystemMessageFilter,
  type TimeFilter,
} from './dbCore'

export {
  initPerfLog,
  logPerf,
  logPerfDetail,
  resetPerfLog,
  getCurrentLogFile,
  logError,
  logInfo,
  logSummary,
  getErrorCount,
  LogLevel,
} from './perfLogger'
