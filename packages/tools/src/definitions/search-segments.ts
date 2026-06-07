/**
 * 段落搜索工具
 *
 * 搜索聊天段落（对话段落），返回匹配的段落列表及预览。
 */

import type { ToolDefinition, ToolExecutionContext, ToolResult, JsonSchema } from '../types'
import { parseExtendedTimeParams } from '../utils/time-params'
import { formatTimeRange, formatMessageCompact, isChineseLocale } from '../utils/format'
import { timeParamProperties } from '../utils/schemas'

const inputSchema: JsonSchema = {
  type: 'object',
  properties: {
    keywords: { type: 'array', items: { type: 'string' }, description: '搜索关键词列表' },
    limit: { type: 'number', description: '返回的最大段落数，默认 20' },
    ...timeParamProperties,
  },
}

async function handler(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const { locale, timeFilter: contextTimeFilter } = context
  const limit = (params.limit as number) || 20
  const effectiveTimeFilter = parseExtendedTimeParams(params as any, contextTimeFilter)

  const segments = await context.dataProvider!.searchSegments(
    params.keywords as string[] | undefined,
    effectiveTimeFilter,
    limit,
    5
  )

  if (segments.length === 0) {
    const data = {
      total: 0,
      message: isChineseLocale(locale) ? '未找到匹配的段落' : 'No matching segments found',
    }
    return { content: JSON.stringify(data), data }
  }

  const localeStr = isChineseLocale(locale) ? 'zh-CN' : 'en-US'
  const msgSuffix = isChineseLocale(locale) ? '条消息' : ' messages'
  const completeLabel = isChineseLocale(locale) ? '完整段落' : 'complete'

  const data = {
    total: segments.length,
    timeRange: formatTimeRange(effectiveTimeFilter, locale),
    segments: segments.map((s) => {
      const startTime = new Date(s.startTs * 1000).toLocaleString(localeStr)
      const endTime = new Date(s.endTs * 1000).toLocaleString(localeStr)
      const completeTag = s.isComplete ? ` [${completeLabel}]` : ''

      return {
        segmentId: s.id,
        time: `${startTime} ~ ${endTime}`,
        messageCount: `${s.messageCount}${msgSuffix}${completeTag}`,
        preview: s.previewMessages.map((m) => formatMessageCompact(m, locale)),
      }
    }),
  }

  return { content: JSON.stringify(data), data }
}

export const searchSegmentsTool: ToolDefinition = {
  name: 'search_segments',
  description:
    '搜索聊天段落（对话段落）。段落是根据消息时间间隔自动切分的对话单元。返回匹配的段落列表及每个段落的前5条消息预览。',
  inputSchema,
  handler,
  category: 'core',
}
