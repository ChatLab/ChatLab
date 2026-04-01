import dayjs from 'dayjs'

/**
 * 日期格式化工具函数
 * 统一处理时间戳的格式化展示
 */

/**
 * 格式化为日期 (YYYY-MM-DD)
 * @param ts Unix 时间戳（秒）
 */
export function formatDate(ts: number): string {
  const date = new Date(ts * 1000)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 格式化为日期时间 (YYYY-MM-DD HH:mm)
 * @param ts Unix 时间戳（秒）
 */
export function formatDateTime(ts: number): string {
  const date = new Date(ts * 1000)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${minute}`
}

/**
 * 格式化为完整日期时间 (YYYY-MM-DD HH:mm:ss)
 * @param ts Unix 时间戳（秒）
 */
export function formatFullDateTime(ts: number): string {
  return dayjs.unix(ts).format('YYYY-MM-DD HH:mm:ss')
}

/**
 * 格式化时间段
 * @param startTs 开始时间戳（秒）
 * @param endTs 结束时间戳（秒），null 表示至今
 */
export function formatPeriod(startTs: number, endTs: number | null): string {
  const start = formatDate(startTs)
  if (endTs === null) {
    return `${start} ~ 至今`
  }
  const end = formatDate(endTs)
  if (start === end) {
    return start
  }
  return `${start} ~ ${end}`
}

/**
 * 格式化距今天数
 * @param days 天数
 */
export function formatDaysSince(days: number): string {
  if (days === 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 30) return `${days} 天前`
  if (days < 365) return `${Math.floor(days / 30)} 个月前`
  return `${Math.floor(days / 365)} 年前`
}

/**
 * 使用 dayjs 格式化日期
 * @param ts Unix 时间戳（秒）
 * @param format 格式字符串
 */
export function formatWithDayjs(ts: number, format: string): string {
  return dayjs.unix(ts).format(format)
}

/**
 * 格式化日期范围（支持自定义格式）
 * @param startTs 开始时间戳（秒）
 * @param endTs 结束时间戳（秒）
 * @param format 日期格式，默认 'YYYY/MM/DD'
 * @param separator 分隔符，默认 ' - '
 */
export function formatDateRange(
  startTs: number,
  endTs: number,
  format: string = 'YYYY/MM/DD',
  separator: string = ' - '
): string {
  const start = dayjs.unix(startTs).format(format)
  const end = dayjs.unix(endTs).format(format)
  if (start === end) {
    return start
  }
  return `${start}${separator}${end}`
}
