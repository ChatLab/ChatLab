<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { StatCard } from '@/components/UI'
import type { WeekdayActivity, DailyActivity, HourlyActivity } from '@/types/analysis'
import dayjs from 'dayjs'

const { t } = useI18n()

defineProps<{
  dailyAvgMessages: number
  durationDays: number
  imageCount: number
  peakHour: HourlyActivity | null
  peakWeekday: WeekdayActivity | null
  weekdayNames: string[]
  weekdayVsWeekend: { weekday: number; weekend: number }
  peakDay: DailyActivity | null
  activeDays: number
  totalDays: number
  activeRate: number
  maxConsecutiveDays: number
}>()
</script>

<template>
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <!-- 日均消息 -->
    <StatCard
      :label="t('analysis.overview.statCards.dailyAvgMessages')"
      :value="t('analysis.overview.statCards.messagesCount', { count: dailyAvgMessages })"
      icon="i-heroicons-chat-bubble-left-right"
      icon-bg="blue"
    >
      <template #subtext>
        <span class="text-sm text-gray-500">
          {{ t('analysis.overview.statCards.daysCount', { count: durationDays }) }}
        </span>
      </template>
    </StatCard>

    <!-- 图片/表情 -->
    <StatCard
      :label="t('analysis.overview.statCards.imageMessages')"
      :value="t('analysis.overview.statCards.imagesCount', { count: imageCount })"
      icon="i-heroicons-photo"
      icon-bg="pink"
    >
      <template #subtext>
        <span class="text-sm text-gray-500">{{ t('analysis.overview.statCards.peakHour') }}</span>
        <span class="ml-1 font-semibold text-pink-500">{{ peakHour?.hour || 0 }}:00</span>
      </template>
    </StatCard>

    <!-- 最活跃星期 -->
    <StatCard
      :label="t('analysis.overview.statCards.mostActiveWeekday')"
      :value="peakWeekday ? weekdayNames[peakWeekday.weekday - 1] : '-'"
      icon="i-heroicons-calendar-days"
      icon-bg="amber"
    >
      <template #subtext>
        <span class="text-sm text-gray-500">
          {{ t('analysis.overview.statCards.messagesOnDay', { count: peakWeekday?.messageCount ?? 0 }) }}
        </span>
      </template>
    </StatCard>

    <!-- 周末活跃度 -->
    <StatCard
      :label="t('analysis.overview.statCards.weekendActivity')"
      :value="`${weekdayVsWeekend.weekend}%`"
      icon="i-heroicons-sun"
      icon-bg="green"
    >
      <template #subtext>
        <span class="text-sm text-gray-500">{{ t('analysis.overview.statCards.weekendRatio') }}</span>
      </template>
    </StatCard>

    <!-- 最活跃日期 -->
    <StatCard
      :label="t('analysis.overview.statCards.mostActiveDate')"
      :value="peakDay ? dayjs(peakDay.date).format('MM/DD') : '-'"
      icon="i-heroicons-fire"
      icon-bg="red"
    >
      <template #subtext>
        <span class="text-sm text-gray-500">
          {{ t('analysis.overview.statCards.messagesOnDay', { count: peakDay?.messageCount ?? 0 }) }}
        </span>
      </template>
    </StatCard>

    <!-- 活跃天数 -->
    <StatCard
      :label="t('analysis.overview.statCards.activeDays')"
      :value="`${activeDays}`"
      icon="i-heroicons-calendar"
      icon-bg="blue"
    >
      <template #subtext>
        <span class="text-sm text-gray-500">
          {{ t('analysis.overview.statCards.slashDays', { count: totalDays }) }}
        </span>
      </template>
    </StatCard>

    <!-- 连续打卡 -->
    <StatCard
      :label="t('analysis.overview.statCards.consecutiveStreak')"
      :value="t('analysis.overview.statCards.daysStreak', { count: maxConsecutiveDays })"
      icon="i-heroicons-bolt"
      icon-bg="amber"
    >
      <template #subtext>
        <span class="text-sm text-gray-500">{{ t('analysis.overview.statCards.longestStreak') }}</span>
      </template>
    </StatCard>

    <!-- 活跃率 -->
    <StatCard
      :label="t('analysis.overview.statCards.activityRate')"
      :value="`${activeRate}%`"
      icon="i-heroicons-chart-bar"
      icon-bg="gray"
    >
      <template #subtext>
        <span class="text-sm text-gray-500">{{ t('analysis.overview.statCards.activeDaysRatio') }}</span>
      </template>
    </StatCard>
  </div>
</template>
