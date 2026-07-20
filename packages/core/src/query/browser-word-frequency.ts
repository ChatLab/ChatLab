import type { DatabaseAdapter } from '../interfaces'
import { cleanText, isStopword, isValidWord, type WordFrequencyParams, type WordFrequencyResult } from '../nlp'
import { buildExcludeKeywordsConditions } from './message-sql'

function tokenize(text: string, locale: string): string[] {
  const cleaned = cleanText(text)
  if (!cleaned) return []

  try {
    const segmenter = new Intl.Segmenter(locale, { granularity: 'word' })
    return [...segmenter.segment(cleaned)].filter((item) => item.isWordLike).map((item) => item.segment)
  } catch {
    return cleaned.match(/[\p{Letter}\p{Number}]+/gu) ?? []
  }
}

/**
 * Browser-safe word-frequency fallback based on Intl.Segmenter.
 *
 * It deliberately supports only token filtering. POS filtering and downloadable
 * dictionaries remain Node-runtime capabilities and are hidden by the Web WASM UI.
 */
export function getBrowserWordFrequency(db: DatabaseAdapter, params: WordFrequencyParams): WordFrequencyResult {
  const {
    locale,
    timeFilter,
    memberId,
    topN = 100,
    minWordLength = locale.startsWith('zh') || locale.startsWith('ja') ? 2 : 3,
    minCount = 2,
    enableStopwords = true,
    excludeWords = [],
    excludeKeywords,
  } = params
  const conditions = [
    "COALESCE(m.account_name, '') != '系统消息'",
    'msg.type = 0',
    'msg.content IS NOT NULL',
    "TRIM(msg.content) != ''",
  ]
  const queryParams: unknown[] = []

  if (timeFilter?.startTs !== undefined) {
    conditions.push('msg.ts >= ?')
    queryParams.push(timeFilter.startTs)
  }
  if (timeFilter?.endTs !== undefined) {
    conditions.push('msg.ts <= ?')
    queryParams.push(timeFilter.endTs)
  }
  if (memberId !== undefined && memberId !== null) {
    conditions.push('msg.sender_id = ?')
    queryParams.push(memberId)
  }
  if (excludeKeywords?.length) {
    const excluded = buildExcludeKeywordsConditions(excludeKeywords)
    conditions.push(...excluded.conditions)
    queryParams.push(...excluded.params)
  }

  const messages = db
    .prepare(
      `SELECT msg.content
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       WHERE ${conditions.join(' AND ')}`
    )
    .all(...queryParams) as Array<{ content: string }>
  const excludedWords = new Set(excludeWords.map((word) => word.trim().toLocaleLowerCase(locale)).filter(Boolean))
  const frequencies = new Map<string, number>()
  let totalWords = 0

  for (const message of messages) {
    for (const rawWord of tokenize(message.content, locale)) {
      const word = rawWord.toLocaleLowerCase(locale)
      if (excludedWords.has(word)) continue
      if (!isValidWord(word, locale, minWordLength, enableStopwords, isStopword)) continue
      frequencies.set(word, (frequencies.get(word) ?? 0) + 1)
      totalWords++
    }
  }

  const ranked = [...frequencies.entries()]
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], locale))
    .slice(0, Math.max(0, topN))
  const rankedTotal = ranked.reduce((sum, [, count]) => sum + count, 0)

  return {
    words: ranked.map(([word, count]) => ({
      word,
      count,
      percentage: rankedTotal > 0 ? Math.round((count / rankedTotal) * 10_000) / 100 : 0,
    })),
    totalWords,
    totalMessages: messages.length,
    uniqueWords: frequencies.size,
  }
}
