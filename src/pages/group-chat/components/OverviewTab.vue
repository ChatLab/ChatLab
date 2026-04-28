<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AnalysisSession, MessageType } from '@/types/base'
import { getMessageTypeName } from '@/types/base'
import type { MemberActivity, HourlyActivity, DailyActivity } from '@/types/analysis'
import { EChartPie } from '@/components/charts'
import type { EChartPieData } from '@/components/charts'
import { SectionCard } from '@/components/UI'
import { useDailyTrend } from '@/composables/analysis/useDailyTrend'
import OverviewIdentityCard from '@/components/analysis/Overview/OverviewIdentityCard.vue'
import DailyTrendCard from '@/components/analysis/Overview/DailyTrendCard.vue'

const { t } = useI18n()

const props = defineProps<{
  session: AnalysisSession
  memberActivity: MemberActivity[]
  topMembers: MemberActivity[]
  bottomMembers: MemberActivity[]
  messageTypes: Array<{ type: MessageType; count: number }>
  hourlyActivity: HourlyActivity[]
  dailyActivity: DailyActivity[]
  timeRange: { start: number; end: number } | null
  selectedYear: number | null
  filteredMessageCount: number
  filteredMemberCount: number
  timeFilter?: { startTs?: number; endTs?: number }
}>()

const { dailyChartData } = useDailyTrend(() => props.dailyActivity)

// 消息类型图表数据
const typeChartData = computed<EChartPieData>(() => {
  return {
    labels: props.messageTypes.map((item) => getMessageTypeName(item.type, t)),
    values: props.messageTypes.map((item) => item.count),
  }
})

// 成员水群分布图表数据
const memberChartData = computed<EChartPieData>(() => {
  const sortedMembers = [...props.memberActivity].sort((a, b) => b.messageCount - a.messageCount)
  const top10 = sortedMembers.slice(0, 10)
  const othersCount = sortedMembers.slice(10).reduce((sum, m) => sum + m.messageCount, 0)

  const labels = top10.map((m) => m.name)
  const values = top10.map((m) => m.messageCount)

  if (othersCount > 0) {
    labels.push(t('analysis.overview.others'))
    values.push(othersCount)
  }

  return {
    labels,
    values,
  }
})
</script>

<template>
  <div class="main-content mx-auto max-w-[920px] space-y-6 p-6">
    <!-- 群聊身份卡 + 关键指标 -->
    <OverviewIdentityCard
      :session="session"
      :daily-activity="dailyActivity"
      :message-types="messageTypes"
      :hourly-activity="hourlyActivity"
      :time-range="timeRange"
      :selected-year="selectedYear"
      :filtered-message-count="filteredMessageCount"
      :time-filter="timeFilter"
    />

    <!-- 图表区域：消息类型 & 成员分布 -->
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <!-- 消息类型分布 -->
      <SectionCard :title="t('analysis.overview.messageTypeDistribution')" :show-divider="false">
        <div class="p-5">
          <EChartPie :data="typeChartData" :height="280" />
        </div>
      </SectionCard>

      <!-- 成员水群分布 -->
      <SectionCard :title="t('analysis.overview.memberDistribution')" :show-divider="false">
        <div class="p-5">
          <EChartPie :data="memberChartData" :height="280" />
        </div>
      </SectionCard>
    </div>

    <!-- 每日消息趋势 -->
    <DailyTrendCard :daily-activity="dailyActivity" :daily-chart-data="dailyChartData" />
  </div>
</template>
