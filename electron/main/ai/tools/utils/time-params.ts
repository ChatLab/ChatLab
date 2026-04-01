/**
 * 时间参数解析工具
 */

export interface ExtendedTimeParams {
  year?: number
  month?: number
  day?: number
  hour?: number
  start_time?: string // 格式: "YYYY-MM-DD HH:mm"
  end_time?: string // 格式: "YYYY-MM-DD HH:mm"
}

/**
 * 解析扩展的时间参数，返回时间过滤器
 * 优先级: start_time/end_time > year/month/day/hour 组合 > context.timeFilter
 */
export function parseExtendedTimeParams(
  params: ExtendedTimeParams,
  contextTimeFilter?: { startTs: number; endTs: number }
): { startTs: number; endTs: number } | undefined {
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

  if (params.year) {
    const year = params.year
    const month = params.month
    const day = params.day
    const hour = params.hour

    let startDate: Date
    let endDate: Date

    if (month && day && hour !== undefined) {
      startDate = new Date(year, month - 1, day, hour, 0, 0)
      endDate = new Date(year, month - 1, day, hour, 59, 59)
    } else if (month && day) {
      startDate = new Date(year, month - 1, day, 0, 0, 0)
      endDate = new Date(year, month - 1, day, 23, 59, 59)
    } else if (month) {
      startDate = new Date(year, month - 1, 1)
      endDate = new Date(year, month, 0, 23, 59, 59)
    } else {
      startDate = new Date(year, 0, 1)
      endDate = new Date(year, 11, 31, 23, 59, 59)
    }

    return {
      startTs: Math.floor(startDate.getTime() / 1000),
      endTs: Math.floor(endDate.getTime() / 1000),
    }
  }

  return contextTimeFilter
}
