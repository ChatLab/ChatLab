/**
 * NLP 查询模块
 * 提供词频统计等 NLP 相关查询功能
 */

import { openDatabase, buildTimeFilter, type TimeFilter } from '../core'
import { segment, batchSegmentWithFrequency, getPosTagDefinitions, collectPosTagStats } from '../../nlp'
import type { SupportedLocale, WordFrequencyResult, WordFrequencyParams, PosTagInfo, PosTagStat } from '../../nlp'

/**
 * 获取词频统计
 * 用于词云展示
 */
export function getWordFrequency(params: WordFrequencyParams): WordFrequencyResult {
  const {
    sessionId,
    locale,
    timeFilter,
    memberId,
    topN = 100,
    minWordLength,
    minCount = 2,
    posFilterMode = 'meaningful',
    customPosTags,
    enableStopwords = true,
  } = params

  const db = openDatabase(sessionId)
  if (!db) {
    return {
      words: [],
      totalWords: 0,
      totalMessages: 0,
      uniqueWords: 0,
    }
  }

  // 构建时间和成员过滤
  const filter: TimeFilter = {
    ...timeFilter,
    memberId,
  }
  const { clause, params: filterParams } = buildTimeFilter(filter, 'msg')

  // 构建 WHERE 子句，排除系统消息
  let whereClause = clause
  if (whereClause.includes('WHERE')) {
    whereClause +=
      " AND COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND TRIM(msg.content) != ''"
  } else {
    whereClause =
      " WHERE COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND TRIM(msg.content) != ''"
  }

  // 查询消息内容
  const messages = db
    .prepare(
      `
      SELECT msg.content
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${whereClause}
      `
    )
    .all(...filterParams) as Array<{ content: string }>

  // 如果没有消息，返回空结果
  if (messages.length === 0) {
    return {
      words: [],
      totalWords: 0,
      totalMessages: 0,
      uniqueWords: 0,
    }
  }

  // 提取文本内容
  const texts = messages.map((m) => m.content)

  // 收集词性统计（用于显示每个词性有多少词，仅中文有效）
  let posTagStats: PosTagStat[] | undefined
  if ((locale as string).startsWith('zh')) {
    const posStatsMap = collectPosTagStats(texts, minWordLength ?? 2, enableStopwords)
    posTagStats = [...posStatsMap.entries()].map(([tag, count]) => ({ tag, count }))
  }

  // 批量分词并统计词频
  const wordFrequency = batchSegmentWithFrequency(texts, locale as SupportedLocale, {
    minLength: minWordLength,
    minCount,
    topN,
    posFilterMode,
    customPosTags,
    enableStopwords,
  })

  // 计算总词数（用于百分比）
  let totalWords = 0
  for (const count of wordFrequency.values()) {
    totalWords += count
  }

  // 构建结果
  const words = [...wordFrequency.entries()].map(([word, count]) => ({
    word,
    count,
    percentage: totalWords > 0 ? Math.round((count / totalWords) * 10000) / 100 : 0,
  }))

  return {
    words,
    totalWords,
    totalMessages: messages.length,
    uniqueWords: wordFrequency.size,
    posTagStats,
  }
}

/**
 * 单文本分词（用于调试或其他用途）
 */
export function segmentText(text: string, locale: SupportedLocale, minLength?: number): string[] {
  return segment(text, locale, { minLength })
}

/**
 * 获取词性标签定义
 */
export function getPosTags(): PosTagInfo[] {
  return getPosTagDefinitions()
}
