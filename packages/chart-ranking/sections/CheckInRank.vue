<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CheckInAnalysis } from '../types'
import { EChartStreakRank } from '../charts'
import { SectionCard, LoadingState, EmptyState, Tabs, TopNSelect } from '@/components/UI'
import { queryCheckInAnalysis } from '../queries'

interface TimeFilter {
  startTs?: number
  endTs?: number
}

const props = withDefaults(
  defineProps<{
    sessionId: string
    timeFilter?: TimeFilter
    /** 是否显示 TopN 选择器 */
    showTopNSelect?: boolean
    /** 全局 TopN 控制（变化时强制同步） */
    globalTopN?: number
  }>(),
  {
    showTopNSelect: true,
  }
)

const analysis = ref<CheckInAnalysis | null>(null)
const isLoading = ref(false)
const streakMode = ref<'max' | 'current'>('max')
const topN = ref(props.globalTopN ?? 10)

// 监听全局 TopN 变化，强制同步
watch(
  () => props.globalTopN,
  (newVal) => {
    if (newVal !== undefined) {
      topN.value = newVal
    }
  }
)

// 计算火花榜标题和描述
const streakTitle = computed(() => (streakMode.value === 'max' ? '🔥 火花榜 - 最长连续' : '🔥 火花榜 - 当前连续'))
const streakDescription = computed(() =>
  streakMode.value === 'max' ? '历史最长连续发言天数' : '正在持续连续发言的成员'
)

// 检查是否有当前连续的成员
const hasCurrentStreak = computed(() => {
  if (!analysis.value) return false
  return analysis.value.streakRank.some((item) => item.currentStreak > 0)
})

async function loadAnalysis() {
  if (!props.sessionId) return
  isLoading.value = true
  try {
    analysis.value = await queryCheckInAnalysis(props.sessionId, props.timeFilter)
  } catch (error) {
    console.error('加载打卡分析失败:', error)
  } finally {
    isLoading.value = false
  }
}

watch(
  () => [props.sessionId, props.timeFilter],
  () => {
    loadAnalysis()
  },
  { immediate: true, deep: true }
)
</script>

<template>
  <div id="streak-rank" class="scroll-mt-24">
    <LoadingState v-if="isLoading" text="正在分析数据..." />

    <SectionCard
      v-else-if="analysis && analysis.streakRank.length > 0"
      :title="streakTitle"
      :description="streakDescription"
    >
      <template #headerRight>
        <div class="flex items-center gap-3">
          <TopNSelect v-if="showTopNSelect" v-model="topN" />
          <Tabs
            v-if="hasCurrentStreak"
            v-model="streakMode"
            :items="[
              { label: '最长连续', value: 'max' },
              { label: '当前连续', value: 'current' },
            ]"
            size="sm"
          />
        </div>
      </template>
      <EChartStreakRank :items="analysis.streakRank" :title="streakTitle" :mode="streakMode" :top-n="topN" bare />
    </SectionCard>

    <SectionCard v-else title="🔥 火花榜">
      <EmptyState text="暂无连续发言数据" />
    </SectionCard>
  </div>
</template>
