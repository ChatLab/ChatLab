/**
 * NLP 模块类型定义
 */

/** 支持的语言 */
export type SupportedLocale = 'zh-CN' | 'en-US' | 'zh-TW' | 'ja-JP'

/** 分词结果 */
export interface SegmentResult {
  /** 分词后的词语列表 */
  words: string[]
  /** 原始文本 */
  original: string
}

/** 词频项 */
export interface WordFrequencyItem {
  /** 词语 */
  word: string
  /** 出现次数 */
  count: number
  /** 占比百分比 */
  percentage: number
}

/** 词性统计项 */
export interface PosTagStat {
  /** 词性标签 */
  tag: string
  /** 该词性的词语数量 */
  count: number
}

/** 词频统计结果 */
export interface WordFrequencyResult {
  /** 词频列表（按出现次数降序） */
  words: WordFrequencyItem[]
  /** 总词数 */
  totalWords: number
  /** 总消息数 */
  totalMessages: number
  /** 唯一词数 */
  uniqueWords: number
  /** 词性统计（每个词性的词语数量） */
  posTagStats?: PosTagStat[]
}

/** 词性过滤模式 */
export type PosFilterMode = 'all' | 'meaningful' | 'custom'

/** 词频统计参数 */
export interface WordFrequencyParams {
  /** 会话 ID */
  sessionId: string
  /** 用户语言设置 */
  locale: SupportedLocale
  /** 时间过滤 */
  timeFilter?: {
    startTs?: number
    endTs?: number
  }
  /** 成员 ID（筛选特定成员） */
  memberId?: number
  /** 返回前 N 个高频词，默认 100 */
  topN?: number
  /** 最小词长，默认中文 2，英文 3 */
  minWordLength?: number
  /** 最小出现次数，默认 2 */
  minCount?: number
  /** 词性过滤模式：all=全部, meaningful=只保留有意义的词, custom=自定义 */
  posFilterMode?: PosFilterMode
  /** 自定义词性过滤列表（posFilterMode='custom' 时使用） */
  customPosTags?: string[]
  /** 是否启用停用词过滤，默认 true */
  enableStopwords?: boolean
}

/** 词性标签信息 */
export interface PosTagInfo {
  /** 词性标签 */
  tag: string
  /** 词性名称（中文） */
  name: string
  /** 词性描述 */
  description: string
  /** 是否为有意义的词性 */
  meaningful: boolean
}

/** 分词器配置 */
export interface SegmenterConfig {
  /** 语言 */
  locale: SupportedLocale
  /** 自定义词典路径（可选，为后期扩展预留） */
  customDictPath?: string
}
