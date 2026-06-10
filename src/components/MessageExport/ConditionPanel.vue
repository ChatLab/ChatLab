<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Tabs from '@/components/UI/Tabs.vue'
import type { ExportFormat } from '@/services/ai/types'

const { t } = useI18n()

const timeRange = defineModel<{ start: number; end: number } | null>('timeRange', { default: null })
const exportFormat = defineModel<ExportFormat>('exportFormat', { default: 'txt' })

const formatTabItems = computed(() => [
  { label: 'TXT', value: 'txt' },
  { label: 'JSON', value: 'json' },
  { label: 'Markdown', value: 'markdown' },
])

type TimeRangePreset = 'all' | 'today' | 'week' | 'month' | '3months' | 'year' | 'custom'
const timeRangeType = ref<TimeRangePreset>('all')
const customStartDate = ref('')
const customEndDate = ref('')

const timeRangePresets = [
  { id: 'all' as TimeRangePreset, label: 'analysis.filter.allTime' },
  { id: 'today' as TimeRangePreset, label: 'analysis.filter.today' },
  { id: 'week' as TimeRangePreset, label: 'analysis.filter.lastWeek' },
  { id: 'month' as TimeRangePreset, label: 'analysis.filter.lastMonth' },
  { id: '3months' as TimeRangePreset, label: 'analysis.filter.last3Months' },
  { id: 'year' as TimeRangePreset, label: 'analysis.filter.lastYear' },
  { id: 'custom' as TimeRangePreset, label: 'analysis.filter.customTime' },
]

const timeRangeTabItems = computed(() =>
  timeRangePresets.map((preset) => ({
    label: t(preset.label),
    value: preset.id,
  }))
)

watch(timeRangeType, () => {
  updateTimeRange()
})

function updateTimeRange() {
  const now = Math.floor(Date.now() / 1000)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStart = Math.floor(today.getTime() / 1000)

  switch (timeRangeType.value) {
    case 'all':
      timeRange.value = null
      break
    case 'today':
      timeRange.value = { start: todayStart, end: now }
      break
    case 'week':
      timeRange.value = { start: now - 7 * 24 * 60 * 60, end: now }
      break
    case 'month':
      timeRange.value = { start: now - 30 * 24 * 60 * 60, end: now }
      break
    case '3months':
      timeRange.value = { start: now - 90 * 24 * 60 * 60, end: now }
      break
    case 'year':
      timeRange.value = { start: now - 365 * 24 * 60 * 60, end: now }
      break
    case 'custom':
      if (customStartDate.value && customEndDate.value) {
        const start = new Date(customStartDate.value).getTime() / 1000
        const end = new Date(customEndDate.value).getTime() / 1000 + 86399
        timeRange.value = { start, end }
      }
      break
  }
}
</script>

<template>
  <div class="space-y-4 p-4">
    <div>
      <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
        {{ t('analysis.filter.timeRange') }}
      </label>
      <Tabs v-model="timeRangeType" :items="timeRangeTabItems" size="sm" />
      <div v-if="timeRangeType === 'custom'" class="mt-2 flex items-center gap-2">
        <input
          v-model="customStartDate"
          type="date"
          class="flex-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
          @change="updateTimeRange"
        />
        <span class="text-gray-500">~</span>
        <input
          v-model="customEndDate"
          type="date"
          class="flex-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
          @change="updateTimeRange"
        />
      </div>
    </div>

    <div>
      <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
        {{ t('analysis.messageExport.format') }}
      </label>
      <Tabs v-model="exportFormat" :items="formatTabItems" size="sm" />
    </div>
  </div>
</template>
