/**
 * 导入模块入口
 * 统一导出流式导入相关函数和类型
 */

// 流式导入（核心导入功能）
export {
  streamImport,
  streamParseFileInfo,
  type StreamImportResult,
  type StreamParseFileInfoResult,
} from './streamImport'

// 增量导入
export {
  analyzeIncrementalImport,
  incrementalImport,
  type IncrementalAnalyzeResult,
  type IncrementalImportResult,
} from './incrementalImport'

// 工具函数（供其他模块使用）
export { sendProgress, generateSessionId, getDbPath, createDatabaseWithoutIndexes, createIndexes } from './utils'

// 临时数据库（供合并功能使用）
export { createTempDatabase, cleanupTempDatabase, generateMessageKey } from './tempDb'
