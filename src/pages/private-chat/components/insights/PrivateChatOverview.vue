<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AnalysisSession, MessageType } from '@/types/base'
import { getMessageTypeName } from '@/types/base'
import type { HourlyActivity, DailyActivity } from '@/types/analysis'
import { EChartPie } from '@/components/charts'
import type { EChartPieData } from '@/components/charts'
import { SectionCard } from '@/components/UI'
import { useDailyTrend } from '@/composables/analysis/useDailyTrend'
import OverviewIdentityCard from '@/components/analysis/Overview/OverviewIdentityCard.vue'
import DailyTrendCard from '@/components/analysis/Overview/DailyTrendCard.vue'

const { t } = useI18n()

const props = defineProps<{
  session: AnalysisSession
  messageTypes: Array<{ type: MessageType; count: number }>
  hourlyActivity: HourlyActivity[]
  dailyActivity: DailyActivity[]
  timeRange: { start: number; end: number } | null
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
</script>

<template>
  <div class="main-content mx-auto max-w-[920px] space-y-4 p-4 sm:space-y-6 sm:p-6">
    <!-- 私聊身份卡 + 关键指标 -->
    <OverviewIdentityCard
      :session="session"
      :daily-activity="dailyActivity"
      :message-types="messageTypes"
      :hourly-activity="hourlyActivity"
      :time-range="timeRange"
      :filtered-message-count="filteredMessageCount"
      :filtered-member-count="filteredMemberCount"
      :time-filter="timeFilter"
    />

    <SectionCard :title="t('analysis.overview.messageTypeDistribution')" :show-divider="false">
      <div class="p-3 sm:p-5">
        <EChartPie :data="typeChartData" :height="280" />
      </div>
    </SectionCard>

    <!-- 每日消息趋势 -->
    <DailyTrendCard :daily-activity="dailyActivity" :daily-chart-data="dailyChartData" />
  </div>
</template>
