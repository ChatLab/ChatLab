<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AnalysisSession, MessageType } from '@/types/base'
import { getMessageTypeName } from '@/types/base'
import type { MemberActivity, HourlyActivity, DailyActivity, WeekdayActivity } from '@/types/analysis'
import { EChartPie } from '@/components/charts'
import type { EChartPieData } from '@/components/charts'
import { SectionCard } from '@/components/UI'
import { useOverviewStatistics } from '@/composables/analysis/useOverviewStatistics'
import { useDailyTrend } from '@/composables/analysis/useDailyTrend'
import OverviewStatCards from '@/components/analysis/Overview/OverviewStatCards.vue'
import OverviewIdentityCard from '@/components/analysis/Overview/OverviewIdentityCard.vue'
import OverviewActionTools from '@/components/analysis/Overview/OverviewActionTools.vue'
import DailyTrendCard from '@/components/analysis/Overview/DailyTrendCard.vue'

const { t } = useI18n()

const emit = defineEmits<{
  (e: 'openSessionIndex'): void
  (e: 'openIncrementalImport'): void
  (e: 'openMessageExport'): void
}>()

const props = defineProps<{
  session: AnalysisSession
  memberActivity: MemberActivity[]
  messageTypes: Array<{ type: MessageType; count: number }>
  hourlyActivity: HourlyActivity[]
  dailyActivity: DailyActivity[]
  timeRange: { start: number; end: number } | null
  selectedYear: number | null
  filteredMessageCount: number
  filteredMemberCount: number
  timeFilter?: { startTs?: number; endTs?: number }
}>()

// 星期活跃度数据（用于统计信息计算）
const weekdayActivity = ref<WeekdayActivity[]>([])

// 使用 Composables
const {
  durationDays,
  dailyAvgMessages,
  totalDurationDays,
  totalDailyAvgMessages,
  imageCount,
  peakHour,
  peakWeekday,
  weekdayNames,
  weekdayVsWeekend,
  peakDay,
  activeDays,
  totalDays,
  activeRate,
  maxConsecutiveDays,
} = useOverviewStatistics(props, weekdayActivity)

const { dailyChartData } = useDailyTrend(() => props.dailyActivity)

// 消息类型图表数据
const typeChartData = computed<EChartPieData>(() => {
  return {
    labels: props.messageTypes.map((item) => getMessageTypeName(item.type, t)),
    values: props.messageTypes.map((item) => item.count),
  }
})

// 双方消息对比数据（取消息数最多的两个成员）
const memberComparisonData = computed(() => {
  // 私聊页面需要至少 2 个成员才能对比
  if (props.memberActivity.length < 2) return null

  // 按消息数排序，取前两名
  const sorted = [...props.memberActivity].sort((a, b) => b.messageCount - a.messageCount)
  const top2 = sorted.slice(0, 2)
  const total = top2[0].messageCount + top2[1].messageCount

  return {
    member1: {
      name: top2[0].name,
      avatar: top2[0].avatar,
      count: top2[0].messageCount,
      percentage: total > 0 ? Math.round((top2[0].messageCount / total) * 100) : 0,
    },
    member2: {
      name: top2[1].name,
      avatar: top2[1].avatar,
      count: top2[1].messageCount,
      percentage: total > 0 ? Math.round((top2[1].messageCount / total) * 100) : 0,
    },
    total,
  }
})

// 双方对比图表数据
const comparisonChartData = computed<EChartPieData>(() => {
  if (!memberComparisonData.value) {
    return { labels: [], values: [] }
  }
  return {
    labels: [memberComparisonData.value.member1.name, memberComparisonData.value.member2.name],
    values: [memberComparisonData.value.member1.count, memberComparisonData.value.member2.count],
  }
})

// 加载星期活跃度数据（用于统计信息计算）
async function loadWeekdayActivity() {
  if (!props.session.id) return
  try {
    weekdayActivity.value = await window.chatApi.getWeekdayActivity(props.session.id, props.timeFilter)
  } catch (error) {
    console.error('加载星期活跃度失败:', error)
  }
}

// 监听 session.id 和 timeFilter 变化
watch(
  () => [props.session.id, props.timeFilter],
  () => {
    loadWeekdayActivity()
  },
  { immediate: true, deep: true }
)
</script>

<template>
  <div class="main-content mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
    <!-- 私聊身份卡 -->
    <OverviewIdentityCard
      :session="session"
      :daily-activity="dailyActivity"
      :total-duration-days="totalDurationDays"
      :total-daily-avg-messages="totalDailyAvgMessages"
      :time-range="timeRange"
    >
      <template #tools>
        <OverviewActionTools
          @open-incremental-import="emit('openIncrementalImport')"
          @open-session-index="emit('openSessionIndex')"
          @open-message-export="emit('openMessageExport')"
        />
      </template>
    </OverviewIdentityCard>

    <!-- 双方消息对比 -->
    <SectionCard v-if="memberComparisonData" :title="t('analysis.overview.messageRatio')" :show-divider="false">
      <div class="p-5">
        <div class="flex items-center gap-8">
          <!-- 左侧成员 -->
          <div class="flex-1 text-center">
            <img
              v-if="memberComparisonData.member1.avatar"
              :src="memberComparisonData.member1.avatar"
              :alt="memberComparisonData.member1.name"
              class="mx-auto h-16 w-16 rounded-full object-cover"
            />
            <div
              v-else
              class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-pink-100 dark:bg-pink-900/30"
            >
              <span class="text-2xl font-bold text-pink-600 dark:text-pink-400">
                {{ memberComparisonData.member1.name.charAt(0) }}
              </span>
            </div>
            <p class="mt-2 text-sm font-medium text-gray-900 dark:text-white">
              {{ memberComparisonData.member1.name }}
            </p>
            <p class="text-2xl font-black text-pink-600 dark:text-pink-400">
              {{ memberComparisonData.member1.percentage }}%
            </p>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              {{ memberComparisonData.member1.count.toLocaleString() }} {{ t('analysis.overview.messageUnit') }}
            </p>
          </div>

          <!-- 中间对比条 -->
          <div class="flex-1">
            <div class="relative h-8 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              <div
                class="absolute left-0 top-0 h-full rounded-l-full bg-pink-500 transition-all"
                :style="{ width: `${memberComparisonData.member1.percentage}%` }"
              />
              <div
                class="absolute right-0 top-0 h-full rounded-r-full bg-blue-500 transition-all"
                :style="{ width: `${memberComparisonData.member2.percentage}%` }"
              />
            </div>
            <div class="mt-2 flex justify-between text-xs text-gray-500">
              <span>{{ memberComparisonData.member1.percentage }}%</span>
              <span>{{ memberComparisonData.member2.percentage }}%</span>
            </div>
          </div>

          <!-- 右侧成员 -->
          <div class="flex-1 text-center">
            <img
              v-if="memberComparisonData.member2.avatar"
              :src="memberComparisonData.member2.avatar"
              :alt="memberComparisonData.member2.name"
              class="mx-auto h-16 w-16 rounded-full object-cover"
            />
            <div
              v-else
              class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30"
            >
              <span class="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {{ memberComparisonData.member2.name.charAt(0) }}
              </span>
            </div>
            <p class="mt-2 text-sm font-medium text-gray-900 dark:text-white">
              {{ memberComparisonData.member2.name }}
            </p>
            <p class="text-2xl font-black text-blue-600 dark:text-blue-400">
              {{ memberComparisonData.member2.percentage }}%
            </p>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              {{ memberComparisonData.member2.count.toLocaleString() }} {{ t('analysis.overview.messageUnit') }}
            </p>
          </div>
        </div>
      </div>
    </SectionCard>

    <!-- 关键指标卡片 -->
    <OverviewStatCards
      :daily-avg-messages="dailyAvgMessages"
      :duration-days="durationDays"
      :image-count="imageCount"
      :peak-hour="peakHour"
      :peak-weekday="peakWeekday"
      :weekday-names="weekdayNames"
      :weekday-vs-weekend="weekdayVsWeekend"
      :peak-day="peakDay"
      :active-days="activeDays"
      :total-days="totalDays"
      :active-rate="activeRate"
      :max-consecutive-days="maxConsecutiveDays"
    />

    <!-- 图表区域：消息类型 & 双方占比 -->
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <!-- 消息类型分布 -->
      <SectionCard :title="t('analysis.overview.messageTypeDistribution')" :show-divider="false">
        <div class="p-5">
          <EChartPie :data="typeChartData" :height="256" />
        </div>
      </SectionCard>

      <!-- 双方消息占比饼图 -->
      <SectionCard v-if="memberComparisonData" :title="t('analysis.overview.memberComparison')" :show-divider="false">
        <div class="p-5">
          <EChartPie :data="comparisonChartData" :height="256" />
        </div>
      </SectionCard>
    </div>

    <!-- 每日消息趋势 -->
    <DailyTrendCard :daily-activity="dailyActivity" :daily-chart-data="dailyChartData" />
  </div>
</template>
