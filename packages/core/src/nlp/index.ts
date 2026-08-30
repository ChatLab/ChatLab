/**
 * NLP 模块（平台无关）
 *
 * 提供类型定义、停用词表、词性标签定义、文本处理工具。
 * 不包含依赖原生模块的分词引擎实现（在 @openchatlab/node-runtime 中）。
 */

export type {
  SupportedLocale,
  PosFilterMode,
  DictType,
  PosTagInfo,
  WordFrequencyItem,
  PosTagStat,
  WordFrequencyResult,
  WordFrequencyParams,
  SegmentOptions,
  BatchSegmentOptions,
  BatchSegmentResult,
  DictInfo,
} from './types'

export { POS_TAG_DEFINITIONS, MEANINGFUL_POS_TAGS } from './pos-tags'

export { CHINESE_STOPWORDS, ENGLISH_STOPWORDS, JAPANESE_STOPWORDS, getStopwords, isStopword } from './stopwords'

export {
  cleanText,
  isMediaPlaceholderContent,
  isValidWord,
  stripMediaPlaceholders,
  stripVoiceTranscriptionPrefix,
} from './text-utils'
