/**
 * 时间统计工具
 *
 * 获取聊天活跃时段分布（小时、星期、每日趋势）。
 */

import type { ToolDefinition, ToolExecutionContext, ToolResult, JsonSchema } from '../types'
import { parseExtendedTimeParams } from '../utils/time-params'
import { timeParamProperties } from '../utils/schemas'

const inputSchema: JsonSchema = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      description: '统计类型：hourly（按小时）、weekday（按星期）、daily（按天）',
      enum: ['hourly', 'weekday', 'daily'],
      default: 'hourly',
    },
    ...timeParamProperties,
  },
}

async function handler(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const type = (params.type as 'hourly' | 'weekday' | 'daily') || 'hourly'
  const effectiveTimeFilter = parseExtendedTimeParams(params as any, context.timeFilter)
  const data = await context.dataProvider!.getTimeStats(type, { timeFilter: effectiveTimeFilter })

  return {
    content: JSON.stringify({ type, data }),
    data,
  }
}

export const timeStatsTool: ToolDefinition = {
  name: 'get_time_stats',
  description: '获取聊天活跃时段分布（按小时/星期/每日趋势）',
  inputSchema,
  handler,
  category: 'analysis',
}
