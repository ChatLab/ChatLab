/**
 * 核心基础设施模块入口
 * 统一导出数据库核心工具和性能日志
 */

export {
  initDbDir,
  getDbPath,
  openDatabase,
  openRawDatabase,
  closeDatabase,
  closeAllDatabases,
  getDbDir,
  getCacheDir,
  getTempDir,
  buildTimeFilter,
  buildSystemMessageFilter,
  wrapAsDatabaseAdapter,
  openDatabaseAdapter,
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
