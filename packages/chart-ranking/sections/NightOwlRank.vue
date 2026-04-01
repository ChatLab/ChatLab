<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { NightOwlAnalysis } from '../types'
import { EChartRank } from '@/components/charts'
import { SectionCard, Tabs, TopNSelect, LoadingState } from '@/components/UI'
import { EChartConsecutiveRank, EChartNightOwlRank } from '../charts'
import { queryNightOwlAnalysis } from '../queries'

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

const analysis = ref<NightOwlAnalysis | null>(null)
const isLoading = ref(false)
const timeRankTab = ref<'first' | 'last'>('first') // 默认最早上班
const nightStatsTab = ref<'distribution' | 'consecutive'>('distribution') // 修仙统计 Tab
const nightStatsTopN = ref(props.globalTopN ?? 10) // 修仙统计 TopN
const timeRankTopN = ref(props.globalTopN ?? 10) // 出勤排行 TopN

// 监听全局 TopN 变化，强制同步所有内部 TopN
watch(
  () => props.globalTopN,
  (newVal) => {
    if (newVal !== undefined) {
      nightStatsTopN.value = newVal
      timeRankTopN.value = newVal
    }
  }
)

async function loadData() {
  if (!props.sessionId) return
  isLoading.value = true
  try {
    analysis.value = await queryNightOwlAnalysis(props.sessionId, props.timeFilter)
  } catch (error) {
    console.error('加载出勤分析失败:', error)
  } finally {
    isLoading.value = false
  }
}

// 最晚下班排行
const lastSpeakerMembers = computed(() => {
  if (!analysis.value) return []
  return analysis.value.lastSpeakerRank.map((item) => ({
    id: String(item.memberId),
    name: item.name,
    value: item.count,
    percentage: item.percentage,
  }))
})

// 最早上班排行
const firstSpeakerMembers = computed(() => {
  if (!analysis.value) return []
  return analysis.value.firstSpeakerRank.map((item) => ({
    id: String(item.memberId),
    name: item.name,
    value: item.count,
    percentage: item.percentage,
  }))
})

// 当前时间排行数据
const currentTimeRankData = computed(() => {
  return timeRankTab.value === 'last' ? lastSpeakerMembers.value : firstSpeakerMembers.value
})

// 时间排行标题
const timeRankTitle = computed(() => {
  return timeRankTab.value === 'last' ? '⏰ 出勤排行 - 最晚下班' : '⏰ 出勤排行 - 最早上班'
})

// 时间排行描述
const timeRankDescription = computed(() => {
  const totalDays = analysis.value?.totalDays ?? 0
  return timeRankTab.value === 'last'
    ? `每天最后一个发言的人（共 ${totalDays} 天）`
    : `每天第一个发言的人（共 ${totalDays} 天）`
})

// 修仙统计标题
const nightStatsTitle = computed(() => {
  return nightStatsTab.value === 'distribution' ? '🦉 修仙统计 - 发言分布' : '🦉 修仙统计 - 连续记录'
})

// 修仙统计描述
const nightStatsDescription = computed(() => {
  return nightStatsTab.value === 'distribution' ? '深夜时段（23:00-05:00）各时段发言分布' : '连续在深夜时段发言的天数'
})

watch(
  () => [props.sessionId, props.timeFilter],
  () => loadData(),
  { immediate: true, deep: true }
)
</script>

<template>
  <div class="space-y-6">
    <LoadingState v-if="isLoading" text="正在加载出勤分析..." />

    <template v-else-if="analysis">
      <!-- 修仙统计（发言分布 + 连续记录） -->
      <SectionCard :title="nightStatsTitle" :description="nightStatsDescription">
        <template #headerRight>
          <div class="flex items-center gap-3">
            <TopNSelect v-if="showTopNSelect" v-model="nightStatsTopN" />
            <Tabs
              v-model="nightStatsTab"
              :items="[
                { label: '发言分布', value: 'distribution' },
                { label: '连续记录', value: 'consecutive' },
              ]"
              size="sm"
            />
          </div>
        </template>

        <!-- 发言分布 -->
        <template v-if="nightStatsTab === 'distribution'">
          <EChartNightOwlRank
            v-if="analysis.nightOwlRank.length > 0"
            :items="analysis.nightOwlRank"
            :top-n="nightStatsTopN"
            title=""
            bare
          />
          <div v-else class="py-8 text-center text-sm text-gray-400">暂无深夜发言数据</div>
        </template>

        <!-- 连续记录 -->
        <template v-else>
          <EChartConsecutiveRank
            v-if="analysis.consecutiveRecords.length > 0"
            :items="analysis.consecutiveRecords"
            :top-n="nightStatsTopN"
            title=""
            bare
          />
          <div v-else class="py-8 text-center text-sm text-gray-400">暂无连续记录</div>
        </template>
      </SectionCard>

      <!-- 出勤排行（最早上班 + 最晚下班） -->
      <SectionCard :title="timeRankTitle" :description="timeRankDescription">
        <template #headerRight>
          <div class="flex items-center gap-3">
            <TopNSelect v-if="showTopNSelect" v-model="timeRankTopN" />
            <Tabs
              v-model="timeRankTab"
              :items="[
                { label: '最早上班', value: 'first' },
                { label: '最晚下班', value: 'last' },
              ]"
              size="sm"
            />
          </div>
        </template>

        <EChartRank
          v-if="currentTimeRankData.length > 0"
          :members="currentTimeRankData"
          :title="timeRankTitle"
          :top-n="timeRankTopN"
          unit="次"
          bare
        />
        <div v-else class="py-8 text-center text-sm text-gray-400">暂无数据</div>
      </SectionCard>
    </template>
  </div>
</template>
