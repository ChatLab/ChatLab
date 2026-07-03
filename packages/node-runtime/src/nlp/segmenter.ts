/**
 * 分词引擎（Node.js 实现，依赖 @node-rs/jieba）
 *
 * 中文使用 jieba，英文/日语使用 Intl.Segmenter。
 * 类型、停用词、文本处理工具来自 @openchatlab/core。
 */

import * as fs from 'fs'
import * as path from 'path'
import { createRequire } from 'module'
import type {
  SupportedLocale,
  PosFilterMode,
  DictType,
  SegmentOptions,
  BatchSegmentOptions,
  BatchSegmentResult,
} from '@openchatlab/core'
import { MEANINGFUL_POS_TAGS, isStopword, cleanText, isValidWord } from '@openchatlab/core'

interface JiebaInstance {
  cut: (text: string, hmm?: boolean) => string[]
  tag: (text: string) => Array<{ tag: string; word: string }>
}

let _nlpDir: string | null = null
const jiebaInstances = new Map<DictType, JiebaInstance>()
const require = createRequire(import.meta.url)

/**
 * 设置自定义词库目录路径（由应用初始化时调用）
 */
export function initNlpDir(nlpDir: string): void {
  _nlpDir = nlpDir
}

export function getNlpDir(): string | null {
  return _nlpDir
}

function existsDictOnDisk(dictId: string): boolean {
  if (!_nlpDir) return false
  return fs.existsSync(path.join(_nlpDir, `${dictId}.dict`))
}

function tryLoadDictFromDisk(dictId: string): Buffer | null {
  if (!_nlpDir) return null
  const dictPath = path.join(_nlpDir, `${dictId}.dict`)
  if (!fs.existsSync(dictPath)) return null
  try {
    return fs.readFileSync(dictPath)
  } catch {
    return null
  }
}

/**
 * 获取 Jieba 实例（支持多词库）
 */
export function getJieba(dictType: DictType = 'default'): JiebaInstance {
  const effectiveType = dictType === 'default' ? 'zh-CN' : dictType
  const cached = jiebaInstances.get(effectiveType)
  if (cached) {
    if (existsDictOnDisk(effectiveType)) return cached
    jiebaInstances.delete(effectiveType)
    console.error(`[NLP] jieba cache invalidated (dict missing): ${effectiveType}`)
  }

  try {
    const { Jieba } = require('@node-rs/jieba')
    let instance: JiebaInstance
    const diskDict = tryLoadDictFromDisk(effectiveType)
    if (diskDict) {
      instance = Jieba.withDict(diskDict)
      console.error(`[NLP] jieba dict loaded: ${effectiveType} (${diskDict.length} bytes)`)
    } else {
      instance = new Jieba()
      console.warn(`[NLP] jieba dict missing: ${effectiveType}, fallback to built-in tokenizer`)
    }
    jiebaInstances.set(effectiveType, instance)
    return instance
  } catch (error) {
    console.error(`[NLP] Failed to load jieba module (dict=${effectiveType}):`, error)
    throw new Error(`jieba 模块加载失败 (${effectiveType})`)
  }
}

/**
 * 清除指定词库的缓存实例（词库更新后调用）
 */
export function clearJiebaInstance(dictType: DictType): void {
  jiebaInstances.delete(dictType)
  console.error(`[NLP] jieba instance cleared: ${dictType}`)
}

function segmentChinese(
  text: string,
  options: { posFilterMode?: PosFilterMode; customPosTags?: string[]; dictType?: DictType } = {}
): string[] {
  const { posFilterMode = 'meaningful', customPosTags, dictType = 'default' } = options
  const cleaned = cleanText(text)
  if (!cleaned) return []

  try {
    const jieba = getJieba(dictType)
    if (posFilterMode === 'all') return jieba.cut(cleaned, false)
    const tagged = jieba.tag(cleaned)
    const allowedTags = posFilterMode === 'custom' && customPosTags ? new Set(customPosTags) : MEANINGFUL_POS_TAGS
    return tagged.filter((item) => allowedTags.has(item.tag)).map((item) => item.word)
  } catch (error) {
    console.error('[NLP] Chinese segmentation failed:', error)
    try {
      return getJieba('default').cut(cleanText(text), false)
    } catch {
      return cleaned.split('')
    }
  }
}

function segmentEnglish(text: string): string[] {
  const cleaned = cleanText(text)
  if (!cleaned) return []
  try {
    const segmenter = new Intl.Segmenter('en', { granularity: 'word' })
    return [...segmenter.segment(cleaned)].filter((s) => s.isWordLike).map((s) => s.segment.toLowerCase())
  } catch {
    return cleaned
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 0)
  }
}

function segmentJapanese(text: string): string[] {
  const cleaned = cleanText(text)
  if (!cleaned) return []
  try {
    const segmenter = new Intl.Segmenter('ja', { granularity: 'word' })
    return [...segmenter.segment(cleaned)].filter((s) => s.isWordLike).map((s) => s.segment)
  } catch {
    return cleaned.split('').filter((ch) => ch.trim().length > 0)
  }
}

/**
 * 通用分词入口
 */
export function segment(text: string, locale: SupportedLocale, options: SegmentOptions = {}): string[] {
  const {
    minLength,
    posFilterMode = 'meaningful',
    customPosTags,
    enableStopwords = true,
    dictType = 'default',
  } = options
  const isChinese = locale.startsWith('zh')
  const isJapanese = locale === 'ja-JP'
  const defaultMinLength = isChinese || isJapanese ? 2 : 3
  const effectiveMinLength = minLength ?? defaultMinLength

  let words: string[]
  if (isChinese) {
    words = segmentChinese(text, { posFilterMode, customPosTags, dictType })
  } else if (isJapanese) {
    words = segmentJapanese(text)
  } else {
    words = segmentEnglish(text)
  }

  return words.filter((word) => isValidWord(word, locale, effectiveMinLength, enableStopwords, isStopword))
}

/**
 * 批量分词并统计词频
 */
export function batchSegmentWithFrequency(
  texts: string[],
  locale: SupportedLocale,
  options: BatchSegmentOptions = {}
): BatchSegmentResult {
  const {
    minLength,
    minCount = 2,
    topN = 100,
    posFilterMode,
    customPosTags,
    enableStopwords,
    dictType,
    excludeWords,
  } = options
  const wordFrequency = new Map<string, number>()
  const excludeSet = excludeWords?.length ? new Set(excludeWords.map((w) => w.toLowerCase())) : null

  for (const text of texts) {
    const words = segment(text, locale, { minLength, posFilterMode, customPosTags, enableStopwords, dictType })
    for (const word of words) {
      if (excludeSet && excludeSet.has(word.toLowerCase())) continue
      wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1)
    }
  }

  const filtered = new Map<string, number>()
  let totalWords = 0
  for (const [word, count] of wordFrequency) {
    if (count >= minCount) {
      filtered.set(word, count)
      totalWords += count
    }
  }

  const sorted = [...filtered.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN)
  return { words: new Map(sorted), uniqueWords: filtered.size, totalWords }
}

/**
 * 中文单遍分词：一次 jieba.tag 同时产出词频与词性统计。
 *
 * 仅适用于中文 meaningful/custom 模式（all 模式走 jieba.cut，无词性）。
 * 输出与 `batchSegmentWithFrequency` + `collectPosTagStats` 组合完全一致，
 * 用于消除对同一批文本重复分词的开销。
 */
export function batchSegmentChineseWithStats(
  texts: string[],
  locale: SupportedLocale,
  options: BatchSegmentOptions = {}
): BatchSegmentResult & { posTagStats: Map<string, number> } {
  const {
    minLength,
    minCount = 2,
    topN = 100,
    posFilterMode = 'meaningful',
    customPosTags,
    enableStopwords = true,
    dictType = 'default',
    excludeWords,
  } = options

  const effectiveMinLength = minLength ?? 2
  const allowedTags = posFilterMode === 'custom' && customPosTags ? new Set(customPosTags) : MEANINGFUL_POS_TAGS
  const excludeSet = excludeWords?.length ? new Set(excludeWords.map((w) => w.toLowerCase())) : null

  const wordFrequency = new Map<string, number>()
  const posTagStats = new Map<string, number>()

  try {
    const jieba = getJieba(dictType)
    for (const text of texts) {
      const cleaned = cleanText(text)
      if (!cleaned) continue
      for (const { tag, word } of jieba.tag(cleaned)) {
        if (!isValidWord(word, locale, effectiveMinLength, enableStopwords, isStopword)) continue
        // 词性统计覆盖全部有效词（与 collectPosTagStats 一致）
        posTagStats.set(tag, (posTagStats.get(tag) || 0) + 1)
        // 词频仅统计命中允许词性的词（与 batchSegmentWithFrequency 一致）
        if (!allowedTags.has(tag)) continue
        if (excludeSet && excludeSet.has(word.toLowerCase())) continue
        wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1)
      }
    }
  } catch (error) {
    console.error('[NLP] Chinese single-pass segmentation failed:', error)
  }

  const filtered = new Map<string, number>()
  let totalWords = 0
  for (const [word, count] of wordFrequency) {
    if (count >= minCount) {
      filtered.set(word, count)
      totalWords += count
    }
  }

  const sorted = [...filtered.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN)
  return { words: new Map(sorted), uniqueWords: filtered.size, totalWords, posTagStats }
}

/**
 * 收集文本的词性统计
 */
export function collectPosTagStats(
  texts: string[],
  minWordLength: number = 2,
  enableStopwords: boolean = true,
  dictType: DictType = 'default'
): Map<string, number> {
  const posStats = new Map<string, number>()
  try {
    const jieba = getJieba(dictType)
    for (const text of texts) {
      const cleaned = cleanText(text)
      if (!cleaned) continue
      const tagged = jieba.tag(cleaned)
      for (const item of tagged) {
        if (!isValidWord(item.word, 'zh-CN', minWordLength, enableStopwords, isStopword)) continue
        posStats.set(item.tag, (posStats.get(item.tag) || 0) + 1)
      }
    }
  } catch (error) {
    console.error('[NLP] Failed to collect POS stats:', error)
  }
  return posStats
}

import { POS_TAG_DEFINITIONS } from '@openchatlab/core'
import type { PosTagInfo } from '@openchatlab/core'

/**
 * 获取所有词性标签信息
 */
export function getPosTagDefinitions(): PosTagInfo[] {
  return POS_TAG_DEFINITIONS
}
