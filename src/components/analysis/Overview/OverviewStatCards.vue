<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { StatCard } from '@/components/UI'
import type { WeekdayActivity, DailyActivity, HourlyActivity } from '@/types/analysis'
import dayjs from 'dayjs'

const { t } = useI18n()

const props = withDefaults(
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
    /** 扁平模式：无边框/阴影，适合嵌入在父级 ThemeCard 内 */
    flat?: boolean
  }>(),
  { flat: false }
)

interface FlatStatItem {
  icon: string
  label: string
  value: string
  subtext: string
  colorClass: string
}

const flatItems = computed<FlatStatItem[]>(() => [
  {
    icon: 'i-heroicons-chat-bubble-left-right',
    label: t('analysis.overview.statCards.dailyAvgMessages'),
    value: t('analysis.overview.statCards.messagesCount', { count: props.dailyAvgMessages }),
    subtext: t('analysis.overview.statCards.daysCount', { count: props.durationDays }),
    colorClass: 'text-blue-600 dark:text-blue-400',
  },
  {
    icon: 'i-heroicons-photo',
    label: t('analysis.overview.statCards.imageMessages'),
    value: t('analysis.overview.statCards.imagesCount', { count: props.imageCount }),
    subtext: `${t('analysis.overview.statCards.peakHour')} ${props.peakHour?.hour || 0}:00`,
    colorClass: 'text-pink-600 dark:text-pink-400',
  },
  {
    icon: 'i-heroicons-calendar-days',
    label: t('analysis.overview.statCards.mostActiveWeekday'),
    value: props.peakWeekday ? props.weekdayNames[props.peakWeekday.weekday - 1] : '-',
    subtext: t('analysis.overview.statCards.messagesOnDay', { count: props.peakWeekday?.messageCount ?? 0 }),
    colorClass: 'text-amber-600 dark:text-amber-400',
  },
  {
    icon: 'i-heroicons-sun',
    label: t('analysis.overview.statCards.weekendActivity'),
    value: `${props.weekdayVsWeekend.weekend}%`,
    subtext: t('analysis.overview.statCards.weekendRatio'),
    colorClass: 'text-green-600 dark:text-green-400',
  },
  {
    icon: 'i-heroicons-fire',
    label: t('analysis.overview.statCards.mostActiveDate'),
    value: props.peakDay ? dayjs(props.peakDay.date).format('MM/DD') : '-',
    subtext: t('analysis.overview.statCards.messagesOnDay', { count: props.peakDay?.messageCount ?? 0 }),
    colorClass: 'text-red-600 dark:text-red-400',
  },
  {
    icon: 'i-heroicons-calendar',
    label: t('analysis.overview.statCards.activeDays'),
    value: `${props.activeDays}`,
    subtext: t('analysis.overview.statCards.slashDays', { count: props.totalDays }),
    colorClass: 'text-blue-600 dark:text-blue-400',
  },
  {
    icon: 'i-heroicons-bolt',
    label: t('analysis.overview.statCards.consecutiveStreak'),
    value: t('analysis.overview.statCards.daysStreak', { count: props.maxConsecutiveDays }),
    subtext: t('analysis.overview.statCards.longestStreak'),
    colorClass: 'text-amber-600 dark:text-amber-400',
  },
  {
    icon: 'i-heroicons-chart-bar',
    label: t('analysis.overview.statCards.activityRate'),
    value: `${props.activeRate}%`,
    subtext: t('analysis.overview.statCards.activeDaysRatio'),
    colorClass: 'text-gray-900 dark:text-white',
  },
])
</script>

<template>
  <!-- flat 模式：嵌入父级 ThemeCard 内的紧凑子卡片 -->
  <div v-if="flat" class="relative z-10 px-6 pb-6 pt-2 sm:px-8">
    <div class="mb-3 flex items-center justify-between">
      <span class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
        Key Metrics
      </span>
    </div>
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div
        v-for="item in flatItems"
        :key="item.icon + item.label"
        class="flex items-start gap-2 rounded-lg bg-white/60 p-2.5 ring-1 ring-gray-900/5 dark:bg-white/5 dark:ring-white/10"
      >
        <UIcon :name="item.icon" class="mt-0.5 h-3.5 w-3.5 shrink-0" :class="item.colorClass" />
        <div class="min-w-0">
          <div class="truncate font-mono text-sm font-black leading-tight tabular-nums" :class="item.colorClass">
            {{ item.value }}
          </div>
          <div class="mt-0.5 truncate text-[10px] font-medium text-gray-500 dark:text-gray-400">
            {{ item.label }}
          </div>
          <div class="mt-0.5 truncate text-[9px] text-gray-400 dark:text-gray-500">
            {{ item.subtext }}
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 标准模式：独立的 StatCard 组件 -->
  <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
