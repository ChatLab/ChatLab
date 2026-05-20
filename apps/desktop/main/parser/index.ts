/**
 * Parser V2 - 模块入口（薄封装）
 * 实际实现已迁移到 @openchatlab/parser 共享包
 */
export {
  detectFormat,
  detectAllFormats,
  getParser,
  getSupportedFormats,
  getFormatFeatureById,
  getPreprocessor,
  scanMultiChatFile,
  needsPreprocess,
  parseFile,
  parseFileWithFormat,
  parseFileSync,
  parseFileInfo,
  streamParseFile,
  findEntryFileInDirectory,
  FormatSniffer,
  createSniffer,
  getFileSize,
  formatFileSize,
  parseTimestamp,
  isValidYear,
  createProgress,
  readFileHeadBytes,
} from '@openchatlab/parser'

export type {
  ParseOptions,
  ParseEvent,
  ParseResult,
  ParseProgress,
  FormatFeature,
  Parser,
  ParsedMeta,
  ParsedMember,
  ParsedMessage,
  MultiChatInfo,
  StreamParseCallbacks,
  StreamParseOptions,
} from '@openchatlab/parser'
