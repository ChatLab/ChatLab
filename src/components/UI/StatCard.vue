<script setup lang="ts">
/**
 * 统计卡片组件
 * 用于展示单个统计指标
 */
defineProps<{
  /** 指标标签 */
  label: string
  /** 指标值 */
  value: string | number
  /** 指标值颜色 */
  valueColor?: 'pink' | 'amber' | 'blue' | 'green' | 'red' | 'gray'
  /** 副文本/补充说明 */
  subtext?: string
  /** 可选的图标（emoji 或 icon name） */
  icon?: string
  /** 图标背景色 */
  iconBg?: 'pink' | 'amber' | 'blue' | 'green' | 'red' | 'gray'
}>()

// 颜色映射
const valueColorMap: Record<string, string> = {
  pink: 'text-pink-600 dark:text-pink-400',
  amber: 'text-amber-600 dark:text-amber-400',
  blue: 'text-blue-600 dark:text-blue-400',
  green: 'text-green-600 dark:text-green-400',
  red: 'text-red-600 dark:text-red-400',
  gray: 'text-gray-900 dark:text-white',
}

const iconBgMap: Record<string, string> = {
  pink: 'bg-pink-100 dark:bg-pink-500/10',
  amber: 'bg-amber-100 dark:bg-amber-500/10',
  blue: 'bg-blue-100 dark:bg-blue-500/10',
  green: 'bg-green-100 dark:bg-green-500/10',
  red: 'bg-red-100 dark:bg-red-500/10',
  gray: 'bg-gray-100 dark:bg-white/5',
}
</script>

<template>
  <div
    class="relative overflow-hidden rounded-[20px] border border-gray-200/60 bg-white p-5 shadow-sm transition-all hover:shadow-md dark:border-white/5 dark:bg-card-dark"
  >
    <div class="flex items-start justify-between">
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-gray-500 dark:text-gray-400">{{ label }}</p>
        <p
          class="mt-2 truncate text-2xl font-bold tracking-tight"
          :class="valueColor ? valueColorMap[valueColor] : 'text-gray-900 dark:text-white'"
        >
          {{ value }}
        </p>
      </div>
      <div
        v-if="icon"
        class="ml-4 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
        :class="iconBgMap[iconBg || 'gray']"
      >
        <UIcon v-if="icon.startsWith('i-')" :name="icon" class="h-5 w-5" />
        <span v-else class="text-xl">{{ icon }}</span>
      </div>
    </div>

    <div v-if="subtext || $slots.subtext" class="mt-4 flex items-center text-sm">
      <slot name="subtext">
        <span class="text-gray-500 dark:text-gray-400">{{ subtext }}</span>
      </slot>
    </div>
  </div>
</template>
