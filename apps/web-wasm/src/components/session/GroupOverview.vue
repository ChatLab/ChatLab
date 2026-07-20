<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import DailyTrendCard from '@/components/analysis/Overview/DailyTrendCard.vue'
import OverviewIdentityCard from '@/components/analysis/Overview/OverviewIdentityCard.vue'
import { EChartPie, type EChartPieData } from '@/components/charts'
import { SectionCard } from '@/components/UI'
import { useDailyTrend } from '@/composables/analysis/useDailyTrend'
import type { DailyActivity, HourlyActivity, MemberActivity } from '@/types/analysis'
import { getMessageTypeName, type AnalysisSession, type MessageType } from '@/types/base'

const { t } = useI18n()

const props = defineProps<{
  session: AnalysisSession
  memberActivity: MemberActivity[]
  messageTypes: Array<{ type: MessageType; count: number }>
  hourlyActivity: HourlyActivity[]
  dailyActivity: DailyActivity[]
  timeRange: { start: number; end: number } | null
  filteredMessageCount: number
  filteredMemberCount: number
  timeFilter?: { startTs?: number; endTs?: number }
}>()

const { dailyChartData } = useDailyTrend(() => props.dailyActivity)

const typeChartData = computed<EChartPieData>(() => ({
  labels: props.messageTypes.map((item) => getMessageTypeName(item.type, t)),
  values: props.messageTypes.map((item) => item.count),
}))

const memberChartData = computed<EChartPieData>(() => {
  const sortedMembers = [...props.memberActivity].sort((left, right) => right.messageCount - left.messageCount)
  const topMembers = sortedMembers.slice(0, 10)
  const otherMessageCount = sortedMembers.slice(10).reduce((total, member) => total + member.messageCount, 0)
  const labels = topMembers.map((member) => member.name)
  const values = topMembers.map((member) => member.messageCount)

  if (otherMessageCount > 0) {
    labels.push(t('analysis.overview.others'))
    values.push(otherMessageCount)
  }

  return { labels, values }
})
</script>

<template>
  <div class="main-content mx-auto max-w-[920px] space-y-4 p-4 sm:space-y-6 sm:p-6">
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

    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <SectionCard :title="t('analysis.overview.messageTypeDistribution')" :show-divider="false">
        <div class="p-3 sm:p-5">
          <EChartPie :data="typeChartData" :height="280" />
        </div>
      </SectionCard>

      <SectionCard :title="t('analysis.overview.memberDistribution')" :show-divider="false">
        <div class="p-3 sm:p-5">
          <EChartPie :data="memberChartData" :height="280" />
        </div>
      </SectionCard>
    </div>

    <DailyTrendCard :daily-activity="dailyActivity" :daily-chart-data="dailyChartData" />
  </div>
</template>
