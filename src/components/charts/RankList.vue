<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { getRankBadgeClass, getRankBarColor } from '@/utils'

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
  <div class="divide-y divide-gray-100 dark:divide-gray-800">
    <div
      v-for="(member, index) in displayMembers"
      :key="member.id"
      class="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
    >
      <!-- 排名 -->
      <div
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold"
        :class="getRankBadgeClass(index)"
      >
        {{ index + 1 }}
      </div>

      <!-- 头像占位 -->
      <div
        v-if="showAvatar"
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-pink-100 to-rose-100 text-sm font-medium text-pink-600 dark:from-pink-900/30 dark:to-rose-900/30 dark:text-pink-400"
      >
        {{ member.name.slice(0, 1) }}
      </div>

      <!-- 名字 -->
      <div class="w-32 shrink-0">
        <p class="wrap-break-word font-medium text-gray-900 dark:text-white">
          {{ member.name }}
        </p>
      </div>

      <!-- 进度条 -->
      <div class="flex flex-1 items-center">
        <div class="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
          <div
            class="h-full rounded-full bg-linear-to-r transition-all"
            :class="getRankBarColor(index)"
            :style="{ width: `${getRelativePercentage(index)}%` }"
          />
        </div>
      </div>

      <!-- 数值和百分比 -->
      <div class="flex shrink-0 items-baseline gap-2 whitespace-nowrap">
        <span class="text-lg font-bold text-gray-900 dark:text-white">{{ member.value }}</span>
        <span class="text-sm text-gray-500">{{ displayUnit }} ({{ member.percentage }}%)</span>
      </div>
    </div>
  </div>
</template>
