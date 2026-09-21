/**
 * 关键词词频分析工具
 *
 * 通过 SQL 获取文本消息，使用 NLP 分词统计高频词。
 * NLP 分词能力通过 context.segmentText 回调注入。
 */

import type { ToolDefinition, ToolExecutionContext, ToolResult, JsonSchema } from '../types'
import { formatTimeRange, isChineseLocale } from '../utils/format'
import { parseExtendedTimeParams, type ExtendedTimeParams } from '../utils/time-params'
import { timeParamProperties } from '../utils/schemas'

interface TextRow {
  content: string
}

const inputSchema: JsonSchema = {
  type: 'object',
  properties: {
    days: {
      type: 'number',
      description: 'Recent days to analyze when no explicit or selected time range is available; defaults to 30',
    },
    top_n: { type: 'number', description: '返回前多少个高频词，默认 50' },
    ...timeParamProperties,
  },
}

async function handler(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const { locale, segmentText } = context
  const isZh = isChineseLocale(locale)
  const days = (params.days as number) || 30
  const topN = (params.top_n as number) || 50

  if (!segmentText) {
    const text = isZh ? '当前环境不支持分词功能' : 'Text segmentation is not available in this environment'
    return { content: text, data: null }
  }

  const effectiveTimeFilter = parseExtendedTimeParams(params as ExtendedTimeParams, context.timeFilter)
  const timeCondition = effectiveTimeFilter
    ? 'ts >= @startTs AND ts <= @endTs'
    : "ts > unixepoch('now', '-' || @days || ' days')"
  const sql = `
    SELECT content FROM message
    WHERE type = 0 AND content IS NOT NULL AND LENGTH(content) > 1
      AND ${timeCondition}
    LIMIT 50000
  `
  const rows = await context.dataProvider!.executeParameterizedSql<TextRow>(
    sql,
    effectiveTimeFilter ? { ...effectiveTimeFilter } : { days }
  )
  if (!rows || rows.length === 0) {
    const text = isZh ? '该时间范围内没有文本消息' : 'No text messages in this time range'
    return { content: text, data: null }
  }

  const texts = rows.map((r) => r.content)
  const segLocale: string = locale?.startsWith('ja') ? 'ja-JP' : locale?.startsWith('zh') ? 'zh-CN' : 'en-US'
  const freqResult = segmentText(texts, segLocale, {
    minCount: 2,
    topN,
    posFilterMode: 'meaningful',
    enableStopwords: true,
  })

  if (freqResult.words.size === 0) {
    const text = isZh ? '分词后没有有意义的高频词' : 'No meaningful high-frequency words found after segmentation'
    return { content: text, data: null }
  }

  const ranking = [...freqResult.words.entries()].map(([word, count], i) => ({
    rank: i + 1,
    word,
    count,
  }))

  const formattedRange = formatTimeRange(effectiveTimeFilter, locale)
  const period =
    typeof formattedRange === 'string'
      ? isZh
        ? `近${days}天`
        : `Last ${days} days`
      : `${formattedRange.start} – ${formattedRange.end}`
  const data = {
    period,
    totalMessages: rows.length,
    totalKeywords: ranking.length,
    keywords: ranking.map((r) => `${r.rank}. ${r.word} (${r.count}${isZh ? '次' : ''})`),
  }

  return { content: JSON.stringify(data), data }
}

export const keywordFrequencyTool: ToolDefinition = {
  name: 'keyword_frequency',
  description: '统计群聊中的高频关键词，通过 NLP 分词分析消息内容。',
  inputSchema,
  handler,
  category: 'analysis',
}
