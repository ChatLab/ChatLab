/**
 * 语言偏好分析模块（私聊专用，平台无关）
 *
 * NLP 能力通过 NlpProvider 接口注入，不直接依赖 @node-rs/jieba。
 * 调用方负责提供对应平台的实现（Electron / Server 用 jieba，浏览器可降级）。
 */

import type { TimeFilter } from '@openchatlab/shared-types'
import type { DatabaseAdapter } from '../../interfaces'
import { buildTimeFilter } from '../filters'
import { isSystemPlaceholderContent } from './text-filters'

// ==================== NLP Provider 接口 ====================

export interface PosTagResult {
  word: string
  tag: string
}

export interface NlpProvider {
  tag(text: string): PosTagResult[]
  isStopword(word: string, locale: string): boolean
  meaningfulPosTags: Set<string>
}

// ==================== 内部常量 ====================

const RE_ELLIPSIS = /\.{2,}|…+|。{2,}/g
const RE_EXCLAMATION = /[!！]+/g
const RE_QUESTION = /[?？]+/g
const RE_TILDE = /[~～]+/g
const RE_PERIOD = /[.。](?![.。])/g
const RE_ENDS_WITH_PUNCT = /[.。!！?？~～…,，;；:：、)\]）】》"'」』\-—]$/

const NOUN_TAGS = new Set(['n', 'nr', 'ns', 'nt', 'nz', 'nw'])
const VERB_TAGS = new Set(['v', 'vn', 'vd', 'vg'])
const ADJ_TAGS = new Set(['a', 'an', 'ad', 'ag'])
const ADV_TAGS = new Set(['d'])
const MODAL_TAGS = new Set(['y', 'e'])

const RE_URL = /https?:\/\/[^\s]+/g
const RE_MENTION = /@[^\s@]+/g
const RE_EMOJI =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu
const RE_PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~，。！？、；：""''（）【】《》…—～·\s]/g
const RE_PURE_NUMBER = /^\d+$/

function cleanTextForNlp(text: string): string {
  return text
    .replace(RE_URL, ' ')
    .replace(RE_MENTION, ' ')
    .replace(RE_EMOJI, ' ')
    .replace(RE_PUNCTUATION, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function countMatches(text: string, regex: RegExp): number {
  regex.lastIndex = 0
  const m = text.match(regex)
  return m ? m.length : 0
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    magA = 0,
    magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}

// ==================== 主入口 ====================

export interface LanguagePreferenceParams {
  locale: string
  timeFilter?: TimeFilter
  nlpProvider?: NlpProvider
}

export function getLanguagePreferenceAnalysis(db: DatabaseAdapter, params: LanguagePreferenceParams): any {
  const { locale, timeFilter, nlpProvider } = params

  const { clause, params: filterParams } = buildTimeFilter(timeFilter)
  let whereClause = clause
  const textFilter =
    " COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND LENGTH(TRIM(msg.content)) >= 2"
  if (whereClause.includes('WHERE')) {
    whereClause += ' AND ' + textFilter
  } else {
    whereClause = ' WHERE ' + textFilter
  }

  const rows = db
    .prepare(
      `SELECT m.id as memberId, COALESCE(m.group_nickname, m.account_name, m.platform_id) as name, msg.content as content
       FROM message msg JOIN member m ON msg.sender_id = m.id ${whereClause} ORDER BY m.id`
    )
    .all(...filterParams) as Array<{ memberId: number; name: string; content: string }>

  if (rows.length === 0) return { members: [], sharedWords: [], similarityScore: 0 }

  const memberMessages = new Map<number, { name: string; messages: string[] }>()
  for (const row of rows) {
    if (isSystemPlaceholderContent(row.content)) continue

    let entry = memberMessages.get(row.memberId)
    if (!entry) {
      entry = { name: row.name, messages: [] }
      memberMessages.set(row.memberId, entry)
    }
    entry.messages.push(row.content)
  }

  const isChinese = locale.startsWith('zh')
  const minWordLength = isChinese ? 2 : 3

  const memberProfiles: any[] = []

  for (const [memberId, { name, messages }] of memberMessages) {
    const wordFreq = new Map<string, number>()
    const posCount = { noun: 0, verb: 0, adjective: 0, adverb: 0, modalParticle: 0, interjection: 0, other: 0 }
    const modalFreq = new Map<string, number>()
    let totalWordCount = 0
    const punct = { ellipsis: 0, exclamation: 0, question: 0, tilde: 0, period: 0, noPunct: 0, total: 0 }
    const phraseFreq = new Map<string, number>()

    for (const content of messages) {
      punct.ellipsis += countMatches(content, RE_ELLIPSIS)
      punct.exclamation += countMatches(content, RE_EXCLAMATION)
      punct.question += countMatches(content, RE_QUESTION)
      punct.tilde += countMatches(content, RE_TILDE)
      punct.period += countMatches(content, RE_PERIOD)
      const trimmed = content.trim()

      if (trimmed.length > 0 && !RE_ENDS_WITH_PUNCT.test(trimmed)) punct.noPunct++
      punct.total++

      if (trimmed.length >= 2) phraseFreq.set(trimmed, (phraseFreq.get(trimmed) || 0) + 1)

      const cleaned = cleanTextForNlp(content)
      if (!cleaned) continue

      if (isChinese && nlpProvider) {
        try {
          const tagged = nlpProvider.tag(cleaned)
          for (const { word, tag } of tagged) {
            if (!word || word.trim().length === 0 || RE_PURE_NUMBER.test(word)) continue
            if (word.length < minWordLength && !MODAL_TAGS.has(tag)) continue

            if (NOUN_TAGS.has(tag)) posCount.noun++
            else if (VERB_TAGS.has(tag)) posCount.verb++
            else if (ADJ_TAGS.has(tag)) posCount.adjective++
            else if (ADV_TAGS.has(tag)) posCount.adverb++
            else if (tag === 'y') posCount.modalParticle++
            else if (tag === 'e') posCount.interjection++
            else posCount.other++

            if (MODAL_TAGS.has(tag)) modalFreq.set(word, (modalFreq.get(word) || 0) + 1)

            if (nlpProvider.meaningfulPosTags.has(tag) || MODAL_TAGS.has(tag)) {
              if (!nlpProvider.isStopword(word, locale)) {
                wordFreq.set(word, (wordFreq.get(word) || 0) + 1)
                totalWordCount++
              }
            }
          }
        } catch {
          /* jieba failure — skip */
        }
      } else {
        try {
          const segmenter = new Intl.Segmenter(locale, { granularity: 'word' })
          for (const seg of segmenter.segment(cleaned)) {
            if (!seg.isWordLike) continue
            const w = seg.segment.toLowerCase()
            if (w.length < minWordLength || RE_PURE_NUMBER.test(w)) continue
            if (nlpProvider?.isStopword(w, locale)) continue
            wordFreq.set(w, (wordFreq.get(w) || 0) + 1)
            totalWordCount++
            posCount.other++
          }
        } catch {
          /* fallback */
        }
      }
    }

    const filteredWords = [...wordFreq.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1])
    const uniqueWords = filteredWords.length
    const topWords = filteredWords.slice(0, 100).map(([word, count]) => ({ word, count }))
    const lexicalDiversity = totalWordCount > 0 ? Math.round((uniqueWords / totalWordCount) * 10000) / 100 : 0

    const modalParticles = [...modalFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word, count]) => ({ word, count }))
    const catchphrases = [...phraseFreq.entries()]
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([content, count]) => ({ content, count }))

    memberProfiles.push({
      memberId,
      name,
      totalMessages: messages.length,
      totalWords: totalWordCount,
      uniqueWords,
      lexicalDiversity,
      topWords,
      posDistribution: posCount,
      modalParticles,
      punctuation: punct,
      catchphrases,
    })
  }

  memberProfiles.sort((a, b) => b.totalMessages - a.totalMessages)

  let sharedWords: any[] = []
  let similarityScore = 0

  if (memberProfiles.length >= 2) {
    const a = memberProfiles[0]
    const b = memberProfiles[1]
    const wordsA = new Map<string, number>(a.topWords.map((w: any) => [w.word, w.count]))
    const wordsB = new Map<string, number>(b.topWords.map((w: any) => [w.word, w.count]))
    const shared: Array<{ word: string; countA: number; countB: number }> = []
    for (const [word, countA] of wordsA) {
      const countB = wordsB.get(word)
      if (countB) shared.push({ word, countA, countB })
    }
    shared.sort((x, y) => y.countA + y.countB - (x.countA + x.countB))
    sharedWords = shared.slice(0, 30)

    const posKeys = ['noun', 'verb', 'adjective', 'adverb', 'modalParticle', 'interjection', 'other'] as const
    const vecA = posKeys.map((k) => a.posDistribution[k] as number)
    const vecB = posKeys.map((k) => b.posDistribution[k] as number)
    similarityScore = Math.round(cosineSimilarity(vecA, vecB) * 100)
  }

  return { members: memberProfiles, sharedWords, similarityScore }
}
