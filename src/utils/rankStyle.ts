/**
 * 排名样式工具函数
 * 统一管理排行榜中的金银铜等排名样式
 */

/** 排名数字样式 */
export function getRankNumberClass(index: number): string {
  if (index === 0) return 'text-amber-500 dark:text-amber-400'
  if (index === 1) return 'text-gray-500 dark:text-gray-300'
  if (index === 2) return 'text-orange-600 dark:text-orange-400'
  return 'text-gray-400 dark:text-gray-500'
}

export function formatRankNumber(index: number): string {
  return String(index + 1).padStart(2, '0')
}

/** 进度条渐变颜色 */
export function getRankBarColor(index: number): string {
  if (index === 0) return 'from-amber-400 to-orange-500'
  if (index === 1) return 'from-gray-300 to-gray-400'
  if (index === 2) return 'from-orange-400 to-amber-600'
  return 'from-primary-300 to-primary-500'
}
