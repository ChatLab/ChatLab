/**
 * 词频统计（Node.js 实现）
 *
 * 从数据库查询消息，调用分词引擎进行词频统计。
 * 供 Electron worker 和 Server HTTP 路由共用。
 */

import { buildExcludeKeywordsConditions, type DatabaseAdapter } from '@openchatlab/core'
import type {
  SupportedLocale,
  DictType,
  WordFrequencyParams,
  WordFrequencyResult,
  PosTagStat,
  BatchSegmentResult,
} from '@openchatlab/core'
import { segment, batchSegmentWithFrequency, batchSegmentChineseWithStats, collectPosTagStats } from './segmenter'

function buildMessageQuery(
  timeFilter?: { startTs?: number; endTs?: number },
  memberId?: number,
  excludeKeywords?: string[]
): { clause: string; params: unknown[] } {
  const conditions: string[] = []
  const params: unknown[] = []

  if (timeFilter?.startTs !== undefined) {
    conditions.push('msg.ts >= ?')
    params.push(timeFilter.startTs)
  }
  if (timeFilter?.endTs !== undefined) {
    conditions.push('msg.ts <= ?')
    params.push(timeFilter.endTs)
  }
  if (memberId !== undefined && memberId !== null) {
    conditions.push('msg.sender_id = ?')
    params.push(memberId)
  }

  if (excludeKeywords && excludeKeywords.length > 0) {
    const exclude = buildExcludeKeywordsConditions(excludeKeywords)
    conditions.push(...exclude.conditions)
    params.push(...exclude.params)
  }

  conditions.push("COALESCE(m.account_name, '') != '系统消息'")
  conditions.push('msg.type = 0')
  conditions.push('msg.content IS NOT NULL')
  conditions.push("TRIM(msg.content) != ''")

  return {
    clause: ` WHERE ${conditions.join(' AND ')}`,
    params,
  }
}

/**
 * 从数据库计算词频统计
 */
export function computeWordFrequency(db: DatabaseAdapter, params: WordFrequencyParams): WordFrequencyResult {
  const {
    locale,
    timeFilter,
    memberId,
    topN = 100,
    minWordLength,
    minCount = 2,
    posFilterMode = 'meaningful',
    customPosTags,
    enableStopwords = true,
    dictType = 'default',
    excludeWords,
    excludeKeywords,
  } = params

  const { clause, params: filterParams } = buildMessageQuery(timeFilter, memberId, excludeKeywords)

  const messages = db
    .prepare(`SELECT msg.content FROM message msg JOIN member m ON msg.sender_id = m.id${clause}`)
    .all(...filterParams) as Array<{ content: string }>

  if (messages.length === 0) {
    return { words: [], totalWords: 0, totalMessages: 0, uniqueWords: 0 }
  }

  const texts = messages.map((m) => m.content)

  const segmentOptions = {
    minLength: minWordLength,
    minCount,
    topN,
    posFilterMode,
    customPosTags,
    enableStopwords,
    dictType: dictType as DictType,
    excludeWords,
  }

  let posTagStats: PosTagStat[] | undefined
  let result: BatchSegmentResult

  // 中文 meaningful/custom 模式下，词频与词性统计可在一次分词内同时产出，避免重复分词。
  if (locale.startsWith('zh') && posFilterMode !== 'all') {
    const combined = batchSegmentChineseWithStats(texts, locale as SupportedLocale, segmentOptions)
    result = { words: combined.words, uniqueWords: combined.uniqueWords, totalWords: combined.totalWords }
    posTagStats = [...combined.posTagStats.entries()].map(([tag, count]) => ({ tag, count }))
  } else {
    if (locale.startsWith('zh')) {
      const posStatsMap = collectPosTagStats(texts, minWordLength ?? 2, enableStopwords, dictType as DictType)
      posTagStats = [...posStatsMap.entries()].map(([tag, count]) => ({ tag, count }))
    }
    result = batchSegmentWithFrequency(texts, locale as SupportedLocale, segmentOptions)
  }

  let topNTotalWords = 0
  for (const count of result.words.values()) topNTotalWords += count

  const words = [...result.words.entries()].map(([word, count]) => ({
    word,
    count,
    percentage: topNTotalWords > 0 ? Math.round((count / topNTotalWords) * 10000) / 100 : 0,
  }))

  return {
    words,
    totalWords: result.totalWords,
    totalMessages: messages.length,
    uniqueWords: result.uniqueWords,
    posTagStats,
  }
}

/**
 * 单文本分词
 */
export function segmentText(text: string, locale: SupportedLocale, minLength?: number): string[] {
  return segment(text, locale, { minLength })
}
