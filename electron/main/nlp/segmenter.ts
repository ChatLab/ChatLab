/**
 * 分词器模块
 * 中文使用 @node-rs/jieba，其他语言使用 Intl.Segmenter
 */

import type { SupportedLocale, PosFilterMode, PosTagInfo } from './types'
import { isStopword } from './stopwords'

// Jieba 实例类型
interface JiebaInstance {
  cut: (text: string, hmm?: boolean) => string[]
  tag: (text: string) => Array<{ tag: string; word: string }>
}

// Jieba 实例（延迟初始化）
let jiebaInstance: JiebaInstance | null = null

/**
 * 获取 Jieba 实例（延迟加载）
 */
function getJieba(): JiebaInstance {
  if (!jiebaInstance) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Jieba } = require('@node-rs/jieba')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { dict } = require('@node-rs/jieba/dict')
      jiebaInstance = Jieba.withDict(dict)
      console.log('[NLP] jieba module loaded')
    } catch (error) {
      console.error('[NLP] Failed to load jieba module:', error)
      throw new Error('jieba 模块加载失败')
    }
  }
  return jiebaInstance
}

/**
 * 词性标签定义
 */
export const POS_TAG_DEFINITIONS: PosTagInfo[] = [
  // 名词类
  { tag: 'n', name: '名词', description: '普通名词', meaningful: true },
  { tag: 'nr', name: '人名', description: '人名', meaningful: true },
  { tag: 'ns', name: '地名', description: '地名', meaningful: true },
  { tag: 'nt', name: '机构名', description: '机构团体名', meaningful: true },
  { tag: 'nz', name: '其他专名', description: '其他专有名词', meaningful: true },
  { tag: 'nw', name: '作品名', description: '作品名', meaningful: true },
  // 动词类（普通动词通常不太有意义，如"是""有""说"等）
  { tag: 'v', name: '动词', description: '普通动词', meaningful: false },
  { tag: 'vn', name: '动名词', description: '动名词', meaningful: true },
  { tag: 'vd', name: '副动词', description: '副动词', meaningful: false },
  { tag: 'vg', name: '动语素', description: '动词性语素', meaningful: false },
  // 形容词类
  { tag: 'a', name: '形容词', description: '普通形容词', meaningful: true },
  { tag: 'an', name: '名形词', description: '名形词', meaningful: true },
  { tag: 'ad', name: '副形词', description: '副形词', meaningful: true },
  { tag: 'ag', name: '形语素', description: '形容词性语素', meaningful: true },
  // 其他有意义
  { tag: 'i', name: '成语', description: '成语', meaningful: true },
  { tag: 'l', name: '习用语', description: '习用语', meaningful: true },
  { tag: 'j', name: '简称', description: '简称略语', meaningful: true },
  // 副词、介词等（通常不太有意义）
  { tag: 'd', name: '副词', description: '副词', meaningful: false },
  { tag: 'p', name: '介词', description: '介词', meaningful: false },
  { tag: 'c', name: '连词', description: '连词', meaningful: false },
  { tag: 'u', name: '助词', description: '助词', meaningful: false },
  { tag: 'r', name: '代词', description: '代词', meaningful: false },
  { tag: 'm', name: '数词', description: '数词', meaningful: false },
  { tag: 'q', name: '量词', description: '量词', meaningful: false },
  { tag: 'f', name: '方位词', description: '方位词', meaningful: false },
  { tag: 't', name: '时间词', description: '时间词', meaningful: false },
  { tag: 'e', name: '叹词', description: '叹词', meaningful: false },
  { tag: 'y', name: '语气词', description: '语气词', meaningful: false },
  { tag: 'o', name: '拟声词', description: '拟声词', meaningful: false },
  { tag: 'x', name: '非语素字', description: '非语素字', meaningful: false },
  { tag: 'w', name: '标点符号', description: '标点符号', meaningful: false },
]

/**
 * 有意义的词性标签集合
 */
export const MEANINGFUL_POS_TAGS = new Set(POS_TAG_DEFINITIONS.filter((t) => t.meaningful).map((t) => t.tag))

/**
 * 获取所有词性标签信息
 */
export function getPosTagDefinitions(): PosTagInfo[] {
  return POS_TAG_DEFINITIONS
}

// 用于过滤的正则表达式
const EMOJI_REGEX =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu
const PUNCTUATION_REGEX = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~，。！？、；：""''（）【】《》…—～·\s]/g
const URL_REGEX = /https?:\/\/[^\s]+/g
const MENTION_REGEX = /@[^\s@]+/g
const PURE_NUMBER_REGEX = /^\d+$/

/**
 * 清理文本
 * 移除表情、URL、@提及、标点等
 */
function cleanText(text: string): string {
  return text
    .replace(URL_REGEX, ' ')
    .replace(MENTION_REGEX, ' ')
    .replace(EMOJI_REGEX, ' ')
    .replace(PUNCTUATION_REGEX, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 判断是否为有效词语
 */
function isValidWord(
  word: string,
  locale: SupportedLocale,
  minLength: number,
  enableStopwords: boolean = true
): boolean {
  // 空字符串
  if (!word || word.trim().length === 0) return false

  // 纯数字
  if (PURE_NUMBER_REGEX.test(word)) return false

  // 长度不足
  if (word.length < minLength) return false

  // 停用词
  if (enableStopwords && isStopword(word, locale)) return false

  return true
}

/**
 * 中文分词选项
 */
interface ChineseSegmentOptions {
  /** 词性过滤模式 */
  posFilterMode?: PosFilterMode
  /** 自定义词性过滤列表 */
  customPosTags?: string[]
}

/**
 * 收集文本的词性统计（用于显示每个词性有多少词）
 * 只统计中文，英文无词性标注
 */
export function collectPosTagStats(
  texts: string[],
  minWordLength: number = 2,
  enableStopwords: boolean = true
): Map<string, number> {
  const posStats = new Map<string, number>()

  try {
    const jieba = getJieba()

    for (const text of texts) {
      const cleaned = cleanText(text)
      if (!cleaned) continue

      const tagged = jieba.tag(cleaned)

      for (const item of tagged) {
        // 检查词是否有效（长度和停用词过滤）
        if (!isValidWord(item.word, minWordLength, 'zh-CN', enableStopwords)) {
          continue
        }
        posStats.set(item.tag, (posStats.get(item.tag) || 0) + 1)
      }
    }
  } catch (error) {
    console.error('[NLP] Failed to collect POS stats:', error)
  }

  return posStats
}

/**
 * 中文分词（使用 jieba 词性标注）
 * @param text 文本
 * @param options 分词选项
 */
function segmentChinese(text: string, options: ChineseSegmentOptions = {}): string[] {
  const { posFilterMode = 'meaningful', customPosTags } = options
  const cleaned = cleanText(text)
  if (!cleaned) return []

  try {
    const jieba = getJieba()

    // 全部模式：直接分词，不做词性过滤
    if (posFilterMode === 'all') {
      return jieba.cut(cleaned, false)
    }

    // 使用词性标注
    const tagged = jieba.tag(cleaned)

    // 根据模式过滤
    let allowedTags: Set<string>
    if (posFilterMode === 'custom' && customPosTags) {
      allowedTags = new Set(customPosTags)
    } else {
      // meaningful 模式
      allowedTags = MEANINGFUL_POS_TAGS
    }

    return tagged.filter((item) => allowedTags.has(item.tag)).map((item) => item.word)
  } catch (error) {
    console.error('[NLP] Chinese segmentation failed:', error)
    // 降级：使用简单分词
    try {
      const jieba = getJieba()
      return jieba.cut(cleaned, false)
    } catch {
      return cleaned.split('')
    }
  }
}

/**
 * 英文分词（使用 Intl.Segmenter）
 */
function segmentEnglish(text: string): string[] {
  const cleaned = cleanText(text)
  if (!cleaned) return []

  try {
    const segmenter = new Intl.Segmenter('en', { granularity: 'word' })
    const segments = segmenter.segment(cleaned)

    return [...segments].filter((segment) => segment.isWordLike).map((segment) => segment.segment.toLowerCase())
  } catch {
    return cleaned
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 0)
  }
}

/**
 * 日语分词（使用 Intl.Segmenter）
 */
function segmentJapanese(text: string): string[] {
  const cleaned = cleanText(text)
  if (!cleaned) return []

  try {
    const segmenter = new Intl.Segmenter('ja', { granularity: 'word' })
    const segments = segmenter.segment(cleaned)

    return [...segments].filter((segment) => segment.isWordLike).map((segment) => segment.segment)
  } catch {
    return cleaned.split('').filter((ch) => ch.trim().length > 0)
  }
}

/**
 * 分词选项
 */
export interface SegmentOptions {
  /** 最小词长（可选，默认中文2，英文3） */
  minLength?: number
  /** 词性过滤模式（仅中文有效） */
  posFilterMode?: PosFilterMode
  /** 自定义词性过滤列表 */
  customPosTags?: string[]
  /** 是否启用停用词过滤 */
  enableStopwords?: boolean
}

/**
 * 通用分词入口
 * @param text 待分词文本
 * @param locale 语言
 * @param options 分词选项
 * @returns 过滤后的分词结果
 */
export function segment(text: string, locale: SupportedLocale, options: SegmentOptions = {}): string[] {
  const { minLength, posFilterMode = 'meaningful', customPosTags, enableStopwords = true } = options
  const isChinese = locale.startsWith('zh')
  const isJapanese = locale === 'ja-JP'
  const defaultMinLength = isChinese || isJapanese ? 2 : 3
  const effectiveMinLength = minLength ?? defaultMinLength

  let words: string[]

  if (isChinese) {
    words = segmentChinese(text, { posFilterMode, customPosTags })
  } else if (isJapanese) {
    words = segmentJapanese(text)
  } else {
    words = segmentEnglish(text)
  }

  return words.filter((word) => isValidWord(word, locale, effectiveMinLength, enableStopwords))
}

/**
 * 批量分词并统计词频选项
 */
export interface BatchSegmentOptions extends SegmentOptions {
  minCount?: number
  topN?: number
}

/**
 * 批量分词并统计词频
 * @param texts 文本数组
 * @param locale 语言
 * @param options 选项
 * @returns 词频 Map
 */
export function batchSegmentWithFrequency(
  texts: string[],
  locale: SupportedLocale,
  options: BatchSegmentOptions = {}
): Map<string, number> {
  const { minLength, minCount = 2, topN = 100, posFilterMode, customPosTags, enableStopwords } = options
  const wordFrequency = new Map<string, number>()

  for (const text of texts) {
    const words = segment(text, locale, { minLength, posFilterMode, customPosTags, enableStopwords })
    for (const word of words) {
      wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1)
    }
  }

  // 过滤低频词
  const filtered = new Map<string, number>()
  for (const [word, count] of wordFrequency) {
    if (count >= minCount) {
      filtered.set(word, count)
    }
  }

  // 排序并取 topN
  const sorted = [...filtered.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN)

  return new Map(sorted)
}
