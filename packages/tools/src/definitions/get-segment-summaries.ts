/**
 * 获取段落摘要列表工具
 */

import type { ToolDefinition, ToolExecutionContext, ToolResult, JsonSchema } from '../types'
import { parseExtendedTimeParams } from '../utils/time-params'
import { formatTimeRange, isChineseLocale } from '../utils/format'
import { timeParamProperties } from '../utils/schemas'

const inputSchema: JsonSchema = {
  type: 'object',
  properties: {
    keywords: { type: 'array', items: { type: 'string' }, description: '按关键词过滤摘要内容' },
    limit: { type: 'number', description: '返回的最大段落数，默认 20' },
    ...timeParamProperties,
  },
}

async function handler(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const { locale, timeFilter: contextTimeFilter } = context
  const limit = (params.limit as number) || 20
  const effectiveTimeFilter = parseExtendedTimeParams(params as any, contextTimeFilter)

  const segments = await context.dataProvider!.getSegmentSummaries({
    limit: limit * 2,
    timeFilter: effectiveTimeFilter,
  })

  if (!segments || segments.length === 0) {
    const data = {
      message: isChineseLocale(locale)
        ? '未找到带摘要的段落。可能还没有生成摘要，请在段落时间线中点击"批量生成"按钮。'
        : 'No segments with summaries found. Summaries may not have been generated yet.',
    }
    return { content: JSON.stringify(data), data }
  }

  let filteredSegments = segments
  const keywords = params.keywords as string[] | undefined
  if (keywords && keywords.length > 0) {
    const lowerKeywords = keywords.map((k) => k.toLowerCase())
    filteredSegments = segments.filter((s) =>
      lowerKeywords.some((keyword) => s.summary?.toLowerCase().includes(keyword))
    )
  }

  filteredSegments = filteredSegments.filter((s) => s.summary)
  const limitedSegments = filteredSegments.slice(0, limit)

  const localeStr = isChineseLocale(locale) ? 'zh-CN' : 'en-US'

  const data = {
    total: filteredSegments.length,
    returned: limitedSegments.length,
    timeRange: formatTimeRange(effectiveTimeFilter, locale),
    segments: limitedSegments.map((s) => {
      const startTime = new Date(s.startTs * 1000).toLocaleString(localeStr)
      const endTime = new Date(s.endTs * 1000).toLocaleString(localeStr)
      return {
        segmentId: s.id,
        time: `${startTime} ~ ${endTime}`,
        messageCount: s.messageCount,
        participants: s.participants,
        summary: s.summary,
      }
    }),
  }

  return { content: JSON.stringify(data), data }
}

export const getSegmentSummariesTool: ToolDefinition = {
  name: 'get_segment_summaries',
  description: '获取段落摘要列表，快速了解群聊历史讨论的主题。可以按关键词搜索讨论过的话题。',
  inputSchema,
  handler,
  category: 'analysis',
}
