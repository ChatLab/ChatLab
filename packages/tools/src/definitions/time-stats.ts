/**
 * 时间统计工具
 *
 * 获取聊天活跃时段分布（小时、星期、每日趋势）。
 */

import type { ToolDefinition, ToolExecutionContext, ToolResult, JsonSchema, ChartHint } from '../types'

const inputSchema: JsonSchema = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      description: '统计类型：hourly（按小时）、weekday（按星期）、daily（按天）',
      enum: ['hourly', 'weekday', 'daily'],
      default: 'hourly',
    },
  },
}

function buildChartHint(type: string, data: unknown): ChartHint | undefined {
  const rows: Array<Record<string, unknown>> | undefined = Array.isArray(data)
    ? data
    : ((data as Record<string, unknown>)?.rows as Array<Record<string, unknown>> | undefined)
  if (!rows || rows.length === 0) return undefined

  const getCount = (row: Record<string, unknown>): number => Number(row.msg_count ?? row.messageCount) || 0
  const getWeekdayLabel = (weekday: unknown): string => {
    const weekdayNum = Number(weekday)
    const labelsByMonday = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']
    if (weekdayNum >= 1 && weekdayNum <= 7) return labelsByMonday[weekdayNum]
    if (weekdayNum === 0) return '周日'
    return String(weekday)
  }

  if (type === 'hourly') {
    return {
      type: 'bar',
      title: '小时活跃度分布',
      data: {
        labels: rows.map((r: Record<string, unknown>) => String(r.hour ?? '') + ':00'),
        values: rows.map(getCount),
        horizontal: false,
      },
    }
  }
  if (type === 'weekday') {
    return {
      type: 'bar',
      title: '星期活跃度分布',
      data: {
        labels: rows.map((r: Record<string, unknown>) => getWeekdayLabel(r.weekday)),
        values: rows.map(getCount),
        horizontal: true,
      },
    }
  }
  if (type === 'daily') {
    return {
      type: 'line',
      title: '每日活跃趋势',
      data: {
        labels: rows.map((r: Record<string, unknown>) => String(r.day ?? r.date ?? '')),
        values: rows.map(getCount),
      },
    }
  }
  return undefined
}

async function handler(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const type = (params.type as 'hourly' | 'weekday' | 'daily') || 'hourly'
  const data = await context.dataProvider!.getTimeStats(type, { timeFilter: context.timeFilter })

  const chartHint = buildChartHint(type, data)

  return {
    content: JSON.stringify({ type, data }),
    data,
    chartHint,
  }
}

export const timeStatsTool: ToolDefinition = {
  name: 'get_time_stats',
  description: '获取聊天活跃时段分布（按小时/星期/每日趋势）',
  inputSchema,
  handler,
  category: 'core',
}
