/**
 * 统一维护版本日志类型到图标/颜色的映射，避免新增 changelog 类型时漏配图标。
 */
export interface ChangeTypeConfigItem {
  icon: string
  color: string
  bgColor: string
}

export const CHANGELOG_TYPE_CONFIG: Record<string, ChangeTypeConfigItem> = {
  feat: {
    icon: 'i-heroicons-sparkles',
    color: 'text-green-500',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
  },
  fix: {
    icon: 'i-heroicons-wrench-screwdriver',
    color: 'text-amber-500',
    bgColor: 'bg-amber-100 dark:bg-amber-900/30',
  },
  refactor: {
    icon: 'i-heroicons-arrow-path-rounded-square',
    color: 'text-indigo-500',
    bgColor: 'bg-indigo-100 dark:bg-indigo-900/30',
  },
  docs: {
    icon: 'i-heroicons-document-text',
    color: 'text-cyan-600',
    bgColor: 'bg-cyan-100 dark:bg-cyan-900/30',
  },
  chore: {
    icon: 'i-heroicons-cog-6-tooth',
    color: 'text-gray-500',
    bgColor: 'bg-gray-100 dark:bg-gray-700/30',
  },
  style: {
    icon: 'i-heroicons-paint-brush',
    color: 'text-blue-500',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
  },
  ci: {
    icon: 'i-heroicons-command-line',
    color: 'text-teal-500',
    bgColor: 'bg-teal-100 dark:bg-teal-900/30',
  },
}

export function getChangeTypeConfig(type: string): ChangeTypeConfigItem | undefined {
  return CHANGELOG_TYPE_CONFIG[type]
}

export function getSupportedChangeTypes(): string[] {
  return Object.keys(CHANGELOG_TYPE_CONFIG)
}
