<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AnnualSummaryRange } from '@openchatlab/shared-types'

interface CalendarDay {
  key: string
  day: number
  count: number
  level: number
  inRange: boolean
}

interface CalendarMonth {
  key: string
  label: string
  leadingDays: number
  days: CalendarDay[]
}

const props = defineProps<{
  range: AnnualSummaryRange
  data: Array<{ date: string; messageCount: number }>
}>()

const { t } = useI18n()

const maxCount = computed(() => Math.max(...props.data.map((item) => item.messageCount), 1))
const counts = computed(() => new Map(props.data.map((item) => [item.date, item.messageCount])))
const startDate = computed(() => new Date(props.range.startTs * 1000))
const endDate = computed(() => new Date(props.range.endTs * 1000))

const months = computed<CalendarMonth[]>(() => {
  const start = startDate.value
  const end = endDate.value
  const result: CalendarMonth[] = []
  const year = props.range.year ?? start.getFullYear()
  const cursor = props.range.mode === 'year' ? new Date(year, 0, 1) : new Date(start.getFullYear(), start.getMonth(), 1)
  const lastMonth = props.range.mode === 'year' ? new Date(year, 11, 1) : new Date(end.getFullYear(), end.getMonth(), 1)

  while (cursor <= lastMonth) {
    const year = cursor.getFullYear()
    const month = cursor.getMonth()
    const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const days = Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1
      const key = `${monthKey}-${String(day).padStart(2, '0')}`
      const date = new Date(year, month, day)
      const count = counts.value.get(key) ?? 0
      const inRange = date >= startOfDay(start) && date <= startOfDay(end)

      return {
        key,
        day,
        count,
        inRange,
        level: inRange && count > 0 ? Math.max(1, Math.ceil((count / maxCount.value) * 4)) : 0,
      }
    })

    result.push({
      key: monthKey,
      label: props.range.mode === 'year' ? t('insight.monthLabel', { month: month + 1 }) : monthKey.replace('-', '/'),
      leadingDays: (new Date(year, month, 1).getDay() + 6) % 7,
      days,
    })
    cursor.setMonth(cursor.getMonth() + 1)
  }

  return result
})

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}
</script>

<template>
  <div class="annual-calendar">
    <div class="annual-calendar-months grid grid-cols-2 gap-x-4 gap-y-5">
      <div v-for="month in months" :key="month.key" class="min-w-0">
        <div class="mb-1.5 text-[11px] font-bold text-gray-500 dark:text-zinc-400">
          {{ month.label }}
        </div>
        <div class="grid grid-cols-7 gap-[3px]" aria-hidden="true">
          <span
            v-for="index in month.leadingDays"
            :key="`blank-${index}`"
            class="aspect-square min-h-[7px] rounded-[3px] bg-gray-50 dark:bg-zinc-800/30"
          />
          <span
            v-for="day in month.days"
            :key="day.key"
            class="aspect-square min-h-[7px] rounded-[3px]"
            :class="{
              'opacity-30': !day.inRange,
              'bg-gray-50 dark:bg-zinc-800/30': day.level === 0,
              'bg-pink-100 dark:bg-pink-500/10': day.level === 1,
              'bg-pink-200 dark:bg-pink-500/25': day.level === 2,
              'bg-pink-400 dark:bg-pink-500/50': day.level === 3,
              'bg-pink-600 dark:bg-pink-500/80': day.level === 4,
            }"
            :title="`${day.key}: ${day.count} ${t('insight.messages')}`"
          />
        </div>
      </div>
    </div>
    <div class="mt-4 flex items-center justify-end gap-1.5 text-[10px] text-gray-400 dark:text-zinc-500">
      <span>{{ t('insight.calendar.less') }}</span>
      <span aria-hidden="true" class="inline-block h-2.5 w-2.5 rounded-[2px] bg-pink-100 dark:bg-pink-500/10" />
      <span aria-hidden="true" class="inline-block h-2.5 w-2.5 rounded-[2px] bg-pink-200 dark:bg-pink-500/25" />
      <span aria-hidden="true" class="inline-block h-2.5 w-2.5 rounded-[2px] bg-pink-400 dark:bg-pink-500/50" />
      <span aria-hidden="true" class="inline-block h-2.5 w-2.5 rounded-[2px] bg-pink-600 dark:bg-pink-500/80" />
      <span>{{ t('insight.calendar.more') }}</span>
    </div>
  </div>
</template>

<style scoped>
.annual-calendar {
  container-type: inline-size;
}

@container (min-width: 234px) {
  .annual-calendar-months {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@container (min-width: 314px) {
  .annual-calendar-months {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
</style>
