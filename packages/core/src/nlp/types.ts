/**
 * NLP 模块类型定义（平台无关）
 */

/** 支持的语言 */
export type SupportedLocale = 'zh-CN' | 'en-US' | 'zh-TW' | 'ja-JP'

/** 词性过滤模式 */
export type PosFilterMode = 'all' | 'meaningful' | 'custom'

/** 词库类型 */
export type DictType = 'default' | 'zh-CN' | 'zh-TW'

/** 词性标签信息 */
export interface PosTagInfo {
  tag: string
  name: string
  description: string
  meaningful: boolean
}

/** 词频项 */
export interface WordFrequencyItem {
  word: string
  count: number
  percentage: number
}

/** 词性统计项 */
export interface PosTagStat {
  tag: string
  count: number
}

/** 词频统计结果 */
export interface WordFrequencyResult {
  words: WordFrequencyItem[]
  totalWords: number
  totalMessages: number
  uniqueWords: number
  posTagStats?: PosTagStat[]
}

/** 词频统计参数 */
export interface WordFrequencyParams {
  sessionId: string
  locale: SupportedLocale
  timeFilter?: { startTs?: number; endTs?: number }
  memberId?: number
  topN?: number
  minWordLength?: number
  minCount?: number
  posFilterMode?: PosFilterMode
  customPosTags?: string[]
  enableStopwords?: boolean
  dictType?: DictType
  excludeWords?: string[]
  /** Blacklist pushdown: messages containing any keyword are excluded from segmentation entirely. */
  excludeKeywords?: string[]
}

/** 分词选项 */
export interface SegmentOptions {
  minLength?: number
  posFilterMode?: PosFilterMode
  customPosTags?: string[]
  enableStopwords?: boolean
  dictType?: DictType
}

/** 批量分词选项 */
export interface BatchSegmentOptions extends SegmentOptions {
  minCount?: number
  topN?: number
  excludeWords?: string[]
}

/** 批量分词结果 */
export interface BatchSegmentResult {
  words: Map<string, number>
  uniqueWords: number
  totalWords: number
}

/** 词库信息 */
export interface DictInfo {
  id: string
  label: string
  locale: string
  downloaded: boolean
  fileSize?: number
}
