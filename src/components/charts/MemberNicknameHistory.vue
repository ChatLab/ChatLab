<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MemberNameHistory } from '@/types/analysis'

const { t } = useI18n()

const props = defineProps<{
  history: MemberNameHistory[]
  /** 是否使用紧凑模式（用于弹窗展示） */
  compact?: boolean
}>()

/**
 * 格式化时间戳为日期字符串
 * 格式：YYYY-MM-DD
 */
function formatDate(ts: number): string {
  const date = new Date(ts * 1000)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 格式化时间段
 */
function formatPeriod(startTs: number, endTs: number | null): string {
  const start = formatDate(startTs)
  if (endTs === null) {
    return t('views.charts.nicknameHistory.periodToNow', { start })
  }
  const end = formatDate(endTs)
  if (start === end) {
    return start
  }
  return t('views.charts.nicknameHistory.periodRange', { start, end })
}

/**
 * 计算是否为当前昵称
 */
function isCurrent(item: MemberNameHistory): boolean {
  return item.endTs === null
}

/**
 * 是否有历史记录
 */
const hasHistory = computed(() => props.history.length > 0)

/**
 * 是否只有一个昵称（无变更）
 */
const singleNickname = computed(() => props.history.length === 1)
</script>

<template>
  <div v-if="hasHistory" :class="compact ? 'py-1' : 'py-2'">
    <!-- 单个昵称时的简化展示 -->
    <div v-if="singleNickname" class="flex items-center gap-1 text-sm">
      <span class="text-gray-900 dark:text-white">{{ history[0].name }}</span>
      <span class="text-xs text-gray-500 dark:text-gray-400">
        （{{ formatPeriod(history[0].startTs, history[0].endTs) }}）
      </span>
    </div>

    <!-- 多个昵称时的时间线展示 -->
    <div v-else class="space-y-0">
      <div v-for="(item, index) in history" :key="index" class="flex gap-3">
        <!-- 时间线节点 -->
        <div class="flex flex-col items-center">
          <div
            class="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
            :class="isCurrent(item) ? 'bg-[#de335e]' : 'bg-gray-300 dark:bg-gray-600'"
          />
          <div v-if="index < history.length - 1" class="h-full min-h-[24px] w-px grow bg-gray-200 dark:bg-gray-700" />
        </div>

        <!-- 内容区域 -->
        <div :class="compact ? 'pb-2' : 'pb-4'" class="flex-1">
          <div class="flex items-center gap-2">
            <span class="text-gray-900 dark:text-white" :class="{ 'font-semibold text-[#de335e]': isCurrent(item) }">
              {{ item.name }}
            </span>
            <UBadge v-if="isCurrent(item)" color="primary" variant="soft" size="xs">
              {{ t('views.charts.nicknameHistory.current') }}
            </UBadge>
          </div>
          <div class="mt-0.5">
            <span class="text-xs text-gray-500 dark:text-gray-400">{{ formatPeriod(item.startTs, item.endTs) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 无历史记录 -->
  <div v-else class="py-4 text-center">
    <span class="text-sm text-gray-400">{{ t('views.charts.nicknameHistory.empty') }}</span>
  </div>
</template>
