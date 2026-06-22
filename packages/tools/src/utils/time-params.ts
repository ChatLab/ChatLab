/**
 * 时间参数解析工具
 *
 * 从 Electron 工具提取的共享实用函数，处理 start_time/end_time 字符串参数。
 */

import type { ToolTimeRange } from '../types'

export interface ExtendedTimeParams {
  start_time?: string
  end_time?: string
}

/**
 * 解析时间参数，返回时间过滤器
 * 优先级: start_time/end_time > contextToolTimeRange
 */
export function parseExtendedTimeParams(
  params: ExtendedTimeParams,
  contextToolTimeRange?: ToolTimeRange
): ToolTimeRange | undefined {
  if (params.start_time || params.end_time) {
    let startTs: number | undefined
    let endTs: number | undefined

    if (params.start_time) {
      const startDate = new Date(params.start_time.replace(' ', 'T'))
      if (!isNaN(startDate.getTime())) {
        startTs = Math.floor(startDate.getTime() / 1000)
      }
    }

    if (params.end_time) {
      const endDate = new Date(params.end_time.replace(' ', 'T'))
      if (!isNaN(endDate.getTime())) {
        endTs = Math.floor(endDate.getTime() / 1000)
      }
    }

    if (startTs !== undefined || endTs !== undefined) {
      return {
        startTs: startTs ?? 0,
        endTs: endTs ?? Math.floor(Date.now() / 1000),
      }
    }
  }

  return contextToolTimeRange
}
