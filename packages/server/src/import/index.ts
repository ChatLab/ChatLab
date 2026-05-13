// Legacy ChatLab-only reader (kept for backward compatibility)
export { parseFile, detectFormat as detectChatLabFormat } from './chatlab-reader'
export type { ParsedData, ImportMeta, ImportMember, ImportMessage, ProgressCallback } from './chatlab-reader'
export { importData } from './importer'
export type { ImportResult, ImportOptions } from './importer'

// New: full-format stream import via @openchatlab/parser
export {
  streamImport,
  detectFormat,
  detectAllFormats,
  getFormatFeatureById,
  getSupportedFormats,
  scanMultiChatFile,
} from './stream-import'
export type {
  StreamImportProgress,
  StreamImportResult,
  StreamImportOptions,
  FormatFeature,
  MultiChatInfo,
} from './stream-import'
