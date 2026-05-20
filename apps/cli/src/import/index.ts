// Legacy ChatLab-only reader (kept for backward compatibility)
export { parseFile, detectFormat as detectChatLabFormat } from './chatlab-reader'
export type { ParsedData, ImportMeta, ImportMember, ImportMessage, ProgressCallback } from './chatlab-reader'
export { importData } from './importer'
export type { ImportResult, ImportOptions } from './importer'

// Full-format stream import via @openchatlab/parser + node-runtime streaming importer
export {
  streamImport,
  incrementalImport,
  analyzeIncrementalImport,
  analyzeNewImport,
  detectFormat,
  detectAllFormats,
  getFormatFeatureById,
  getSupportedFormats,
  scanMultiChatFile,
  findEntryFileInDirectory,
} from './stream-import'
export type {
  StreamImportProgress,
  StreamImportResult,
  StreamImportOptions,
  FormatFeature,
  MultiChatInfo,
  IncrementalImportResult,
  IncrementalAnalyzeResult,
  AnalyzeNewImportResult,
} from './stream-import'
