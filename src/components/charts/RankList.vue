<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatRankNumber, getRankBarColor, getRankNumberClass } from '@/utils'

const { t } = useI18n()

export interface RankItem {
  id: string
  name: string
  value: number
  percentage: number
}

interface Props {
  members: RankItem[]
  showAvatar?: boolean
  rankLimit?: number // 限制显示数量，0 表示不限制
  unit?: string // 单位名称
}

const props = withDefaults(defineProps<Props>(), {
  showAvatar: false,
  rankLimit: 0,
})

// 获取单位，优先使用 props，否则使用默认翻译
const displayUnit = computed(() => props.unit || t('views.charts.rankList.unit'))

const displayMembers = computed(() => {
  return props.rankLimit > 0 ? props.members.slice(0, props.rankLimit) : props.members
})

// 获取相对于第一名的百分比
function getRelativePercentage(index: number): number {
  if (displayMembers.value.length === 0) return 0
  const maxValue = displayMembers.value[0].value
  if (maxValue === 0) return 0
  return Math.round((displayMembers.value[index].value / maxValue) * 100)
}
</script>

<template>
  <div>
    <div
      v-for="(member, index) in displayMembers"
      :key="member.id"
      class="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-gray-50/70 dark:hover:bg-white/5"
    >
      <!-- 排名 -->
      <span
        class="w-8 shrink-0 pt-0.5 text-center font-mono text-sm font-black tabular-nums"
        :class="getRankNumberClass(index)"
      >
        {{ formatRankNumber(index) }}
      </span>

      <!-- 头像占位 -->
      <div
        v-if="showAvatar"
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-pink-100 to-rose-100 text-sm font-medium text-pink-600 dark:from-pink-900/30 dark:to-rose-900/30 dark:text-pink-400"
      >
        {{ member.name.slice(0, 1) }}
      </div>

      <div class="min-w-0 flex-1">
        <div class="flex items-baseline justify-between gap-3">
          <p class="truncate text-sm font-medium text-gray-900 dark:text-white" :title="member.name">
            {{ member.name }}
          </p>
          <div class="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap">
            <span class="font-mono text-base font-black tabular-nums text-gray-900 dark:text-white">
              {{ member.value }}
            </span>
            <span class="text-xs text-gray-500 dark:text-gray-400">{{ displayUnit }}</span>
          </div>
        </div>

        <div class="mt-2 flex items-center gap-2.5">
          <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-white/5">
            <div
              class="h-full rounded-full bg-linear-to-r transition-all"
              :class="getRankBarColor(index)"
              :style="{ width: `${getRelativePercentage(index)}%` }"
            />
          </div>
          <span class="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
            {{ member.percentage }}%
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
