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
  <div class="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
    <div v-for="month in months" :key="month.key" class="min-w-0">
      <div class="mb-1.5 text-[10px] font-semibold text-gray-500 dark:text-zinc-400">
        {{ month.label }}
      </div>
      <div class="grid grid-cols-7 gap-0.5" aria-hidden="true">
        <span v-for="index in month.leadingDays" :key="`blank-${index}`" class="aspect-square" />
        <span
          v-for="day in month.days"
          :key="day.key"
          class="aspect-square min-h-[5px] rounded-[2px] bg-gray-100 dark:bg-zinc-800"
          :class="{
            'opacity-30': !day.inRange,
            'bg-pink-200 dark:bg-pink-950': day.level === 1,
            'bg-pink-300 dark:bg-pink-800': day.level === 2,
            'bg-pink-500 dark:bg-pink-600': day.level === 3,
            'bg-pink-700 dark:bg-pink-400': day.level === 4,
          }"
          :title="`${day.key}: ${day.count} ${t('insight.messages')}`"
        />
      </div>
    </div>
  </div>
</template>
