<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import { formatDateRange } from '@/utils'
import UITabs from '@/components/UI/Tabs.vue'
import DatePicker from '@/components/UI/DatePicker.vue'

// ==================== 类型定义（导出供父组件使用） ====================

export type TimeSelectMode = 'recent' | 'quarter' | 'year' | 'custom'

/** 组件内部状态快照，用于父组件 URL 序列化 */
export interface TimeSelectState {
  mode: TimeSelectMode
  recentDays?: number // 最近模式：天数 (180/365/730/1825/0=全部)
  year?: number // 按年模式：年份
  quarterYear?: number // 按季模式：年份
  quarter?: number // 按季模式：季度 (1-4)
  customStart?: string // 自定义模式：开始日期 YYYY-MM-DD
  customEnd?: string // 自定义模式：结束日期 YYYY-MM-DD
}

/** v-model 绑定值 */
export interface TimeRangeValue {
  startTs: number
  endTs: number
  /** 显示标签，用于父组件展示（如 "最近一年" / "2024年 第3季度"） */
  displayLabel: string
  /** 是否选中「全部」范围（父组件据此决定使用 session 总数还是筛选数） */
  isFullRange: boolean
  /** 内部状态快照，便于父组件 URL 序列化 */
  state: TimeSelectState
}

// ==================== Props & Emits ====================

interface Props {
  sessionId: string | undefined
  modelValue: TimeRangeValue | null
  visible?: boolean
  /** 初始状态（通常从 URL query 构建） */
  initialState?: Partial<TimeSelectState>
}

const props = withDefaults(defineProps<Props>(), {
  visible: true,
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: TimeRangeValue): void
  (e: 'update:fullRange', value: { start: number; end: number } | null): void
  (e: 'update:availableYears', value: number[]): void
}>()

const { t } = useI18n()

// ==================== 内部数据 ====================

const isLoaded = ref(false)
const availableYears = ref<number[]>([])
const fullTimeRange = ref<{ start: number; end: number } | null>(null)

// 模式
const mode = ref<TimeSelectMode>('recent')
// 最近
const recentPeriod = ref<number>(365)
// 按年
const selectedYear = ref<number>(0)
// 按季
const selectedQuarterYear = ref<number>(0)
const selectedQuarter = ref<number>(1)
// 自定义
const customStartDate = ref<string>('')
const customEndDate = ref<string>('')

// 是否正在内部初始化（防止 watcher 重复 emit）
const isInitializing = ref(false)

// ==================== 工具函数 ====================

function getQuarterFromTs(ts: number): { year: number; quarter: number } {
  const date = new Date(ts * 1000)
  return {
    year: date.getFullYear(),
    quarter: Math.floor(date.getMonth() / 3) + 1,
  }
}

function getQuarterRange(year: number, quarter: number): { startTs: number; endTs: number } {
  const startMonth = (quarter - 1) * 3
  const startDate = new Date(year, startMonth, 1, 0, 0, 0)
  const endDate = new Date(year, startMonth + 3, 0, 23, 59, 59) // 季度最后一天
  return {
    startTs: Math.floor(startDate.getTime() / 1000),
    endTs: Math.floor(endDate.getTime() / 1000),
  }
}

function getYearRange(year: number): { startTs: number; endTs: number } {
  const startDate = new Date(year, 0, 1, 0, 0, 0)
  const endDate = new Date(year, 11, 31, 23, 59, 59)
  return {
    startTs: Math.floor(startDate.getTime() / 1000),
    endTs: Math.floor(endDate.getTime() / 1000),
  }
}

// ==================== 选项配置 ====================

const modeOptions = computed(() => [
  { label: t('common.timeSelect.mode.recent'), value: 'recent' as const },
  { label: t('common.timeSelect.mode.quarter'), value: 'quarter' as const },
  { label: t('common.timeSelect.mode.year'), value: 'year' as const },
  { label: t('common.timeSelect.mode.custom'), value: 'custom' as const },
])

const recentOptions = computed(() => [
  { label: t('common.timeSelect.recent.halfYear'), value: 180 },
  { label: t('common.timeSelect.recent.oneYear'), value: 365 },
  { label: t('common.timeSelect.recent.twoYears'), value: 730 },
  { label: t('common.timeSelect.recent.fiveYears'), value: 1825 },
  { label: t('common.timeSelect.recent.all'), value: 0 },
])

// ==================== 导航边界 ====================

const minQuarter = computed(() => {
  if (!fullTimeRange.value) return { year: 0, quarter: 1 }
  return getQuarterFromTs(fullTimeRange.value.start)
})

const maxQuarter = computed(() => {
  if (!fullTimeRange.value) return { year: 0, quarter: 1 }
  return getQuarterFromTs(fullTimeRange.value.end)
})

const canPrevQuarter = computed(() => {
  const min = minQuarter.value
  return (
    selectedQuarterYear.value > min.year ||
    (selectedQuarterYear.value === min.year && selectedQuarter.value > min.quarter)
  )
})

const canNextQuarter = computed(() => {
  const max = maxQuarter.value
  return (
    selectedQuarterYear.value < max.year ||
    (selectedQuarterYear.value === max.year && selectedQuarter.value < max.quarter)
  )
})

const canPrevYear = computed(() => {
  if (availableYears.value.length === 0) return false
  const currentIdx = availableYears.value.indexOf(selectedYear.value)
  return currentIdx < availableYears.value.length - 1 // years 降序
})

const canNextYear = computed(() => {
  if (availableYears.value.length === 0) return false
  const currentIdx = availableYears.value.indexOf(selectedYear.value)
  return currentIdx > 0 // years 降序
})

// ==================== 显示标签 ====================

const quarterDisplayLabel = computed(() => {
  return t('common.timeSelect.quarter.label', {
    year: selectedQuarterYear.value,
    quarter: selectedQuarter.value,
  })
})

const yearDisplayLabel = computed(() => {
  return t('common.timeSelect.year.label', { year: selectedYear.value })
})

// ==================== 核心：构建输出值 ====================

/** 最近模式 displayLabel 映射 */
function getRecentDisplayLabel(days: number): string {
  const map: Record<number, string> = {
    180: t('common.timeSelect.display.recent180'),
    365: t('common.timeSelect.display.recent365'),
    730: t('common.timeSelect.display.recent730'),
    1825: t('common.timeSelect.display.recent1825'),
  }
  return map[days] || ''
}

function buildValue(): TimeRangeValue | null {
  if (!fullTimeRange.value) return null
  const stateBase: TimeSelectState = { mode: mode.value }

  switch (mode.value) {
    case 'recent': {
      stateBase.recentDays = recentPeriod.value
      if (recentPeriod.value === 0) {
        // 全部
        return {
          startTs: fullTimeRange.value.start,
          endTs: fullTimeRange.value.end,
          displayLabel: formatDateRange(fullTimeRange.value.start, fullTimeRange.value.end),
          isFullRange: true,
          state: stateBase,
        }
      }
      const endTs = fullTimeRange.value.end
      const startTs = Math.max(endTs - recentPeriod.value * 86400, fullTimeRange.value.start)
      return {
        startTs,
        endTs,
        displayLabel: getRecentDisplayLabel(recentPeriod.value),
        isFullRange: false,
        state: stateBase,
      }
    }
    case 'quarter': {
      stateBase.quarterYear = selectedQuarterYear.value
      stateBase.quarter = selectedQuarter.value
      const range = getQuarterRange(selectedQuarterYear.value, selectedQuarter.value)
      return {
        ...range,
        displayLabel: quarterDisplayLabel.value,
        isFullRange: false,
        state: stateBase,
      }
    }
    case 'year': {
      stateBase.year = selectedYear.value
      const range = getYearRange(selectedYear.value)
      return {
        ...range,
        displayLabel: yearDisplayLabel.value,
        isFullRange: false,
        state: stateBase,
      }
    }
    case 'custom': {
      stateBase.customStart = customStartDate.value
      stateBase.customEnd = customEndDate.value
      if (!customStartDate.value || !customEndDate.value) return null
      let startTs = dayjs(customStartDate.value).startOf('day').unix()
      let endTs = dayjs(customEndDate.value).endOf('day').unix()
      // 如果开始 > 结束，交换
      if (startTs > endTs) [startTs, endTs] = [endTs, startTs]
      return {
        startTs,
        endTs,
        displayLabel: formatDateRange(startTs, endTs),
        isFullRange: false,
        state: stateBase,
      }
    }
  }
}

function emitCurrentValue() {
  const value = buildValue()
  if (value) emit('update:modelValue', value)
}

// ==================== 导航方法 ====================

function navigateQuarter(direction: number) {
  let y = selectedQuarterYear.value
  let q = selectedQuarter.value + direction
  if (q > 4) {
    y++
    q = 1
  }
  if (q < 1) {
    y--
    q = 4
  }
  const min = minQuarter.value
  const max = maxQuarter.value
  if (y < min.year || (y === min.year && q < min.quarter)) return
  if (y > max.year || (y === max.year && q > max.quarter)) return
  selectedQuarterYear.value = y
  selectedQuarter.value = q
  emitCurrentValue()
}

function navigateYear(direction: number) {
  const years = availableYears.value // 降序
  const currentIdx = years.indexOf(selectedYear.value)
  // direction 1 = 向后（更新年份，idx 更小），-1 = 向前（更旧年份，idx 更大）
  const newIdx = currentIdx - direction
  if (newIdx >= 0 && newIdx < years.length) {
    selectedYear.value = years[newIdx]
    emitCurrentValue()
  }
}

// ==================== 模式切换默认值 ====================

function initModeDefaults(newMode: TimeSelectMode) {
  if (!fullTimeRange.value) return
  switch (newMode) {
    case 'recent':
      if (![180, 365, 730, 1825, 0].includes(recentPeriod.value)) {
        recentPeriod.value = 365
      }
      break
    case 'quarter': {
      const { year, quarter } = getQuarterFromTs(fullTimeRange.value.end)
      selectedQuarterYear.value = year
      selectedQuarter.value = quarter
      break
    }
    case 'year': {
      selectedYear.value = availableYears.value[0] || new Date(fullTimeRange.value.end * 1000).getFullYear()
      break
    }
    case 'custom': {
      const endTs = fullTimeRange.value.end
      const startTs = Math.max(endTs - 30 * 86400, fullTimeRange.value.start)
      customStartDate.value = dayjs.unix(startTs).format('YYYY-MM-DD')
      customEndDate.value = dayjs.unix(endTs).format('YYYY-MM-DD')
      break
    }
  }
}

// ==================== 双向绑定模型 ====================

/** 模式选择器（USelect v-model） */
const modeModel = computed({
  get: () => mode.value,
  set: (val: TimeSelectMode) => {
    mode.value = val
    isInitializing.value = true
    initModeDefaults(val)
    isInitializing.value = false
    emitCurrentValue()
  },
})

/** 最近选项（UITabs v-model） */
const recentPeriodModel = computed({
  get: () => recentPeriod.value,
  set: (val: number) => {
    recentPeriod.value = val
    emitCurrentValue()
  },
})

/** 自定义开始日期 */
const customStartModel = computed({
  get: () => customStartDate.value,
  set: (val: string) => {
    customStartDate.value = val
    if (customEndDate.value) emitCurrentValue()
  },
})

/** 自定义结束日期 */
const customEndModel = computed({
  get: () => customEndDate.value,
  set: (val: string) => {
    customEndDate.value = val
    if (customStartDate.value) emitCurrentValue()
  },
})

// ==================== 数据加载 ====================

async function loadData() {
  if (!props.sessionId) {
    availableYears.value = []
    fullTimeRange.value = null
    emit('update:fullRange', null)
    emit('update:availableYears', [])
    isLoaded.value = true
    return
  }

  try {
    const [years, range] = await Promise.all([
      window.chatApi.getAvailableYears(props.sessionId),
      window.chatApi.getTimeRange(props.sessionId),
    ])
    availableYears.value = years
    fullTimeRange.value = range
    emit('update:fullRange', range)
    emit('update:availableYears', years)

    // 从 initialState 或默认值初始化
    const init = props.initialState
    const initMode = init?.mode ?? 'recent'
    mode.value = initMode

    isInitializing.value = true
    switch (initMode) {
      case 'recent':
        recentPeriod.value = init?.recentDays ?? 365
        break
      case 'quarter': {
        if (init?.quarterYear && init?.quarter) {
          selectedQuarterYear.value = init.quarterYear
          selectedQuarter.value = init.quarter
        } else if (range) {
          const { year, quarter } = getQuarterFromTs(range.end)
          selectedQuarterYear.value = year
          selectedQuarter.value = quarter
        }
        break
      }
      case 'year': {
        if (init?.year && years.includes(init.year)) {
          selectedYear.value = init.year
        } else {
          selectedYear.value = years[0] || 0
        }
        break
      }
      case 'custom': {
        if (init?.customStart && init?.customEnd) {
          customStartDate.value = init.customStart
          customEndDate.value = init.customEnd
        } else if (range) {
          const endTs = range.end
          const startTs = Math.max(endTs - 30 * 86400, range.start)
          customStartDate.value = dayjs.unix(startTs).format('YYYY-MM-DD')
          customEndDate.value = dayjs.unix(endTs).format('YYYY-MM-DD')
        }
        break
      }
    }
    isInitializing.value = false

    emitCurrentValue()
  } catch (error) {
    console.error('TimeSelect 加载数据失败:', error)
    availableYears.value = []
    fullTimeRange.value = null
    emit('update:fullRange', null)
    emit('update:availableYears', [])
  } finally {
    isLoaded.value = true
  }
}

onMounted(() => loadData())
watch(
  () => props.sessionId,
  () => {
    isLoaded.value = false
    loadData()
  }
)
</script>

<template>
  <div v-if="isLoaded" class="flex items-center gap-2" :class="{ invisible: !visible }">
    <!-- 模式选择器 -->
    <USelect v-model="modeModel" :items="modeOptions" size="md" class="w-28 shrink-0" />

    <!-- 最近模式：UITabs 选择时间段 -->
    <UITabs
      v-if="mode === 'recent'"
      v-model="recentPeriodModel"
      :items="recentOptions"
      size="sm"
      class="min-w-0 shrink"
    />

    <!-- 按季模式：箭头导航 -->
    <div v-else-if="mode === 'quarter'" class="flex items-center">
      <UButton
        icon="i-heroicons-chevron-left"
        size="sm"
        variant="ghost"
        color="neutral"
        :disabled="!canPrevQuarter"
        @click="navigateQuarter(-1)"
      />
      <span class="whitespace-nowrap px-0.5 text-sm font-medium text-gray-700 dark:text-gray-300">
        {{ quarterDisplayLabel }}
      </span>
      <UButton
        icon="i-heroicons-chevron-right"
        size="sm"
        variant="ghost"
        color="neutral"
        :disabled="!canNextQuarter"
        @click="navigateQuarter(1)"
      />
    </div>

    <!-- 按年模式：箭头导航 -->
    <div v-else-if="mode === 'year'" class="flex items-center">
      <UButton
        icon="i-heroicons-chevron-left"
        size="sm"
        variant="ghost"
        color="neutral"
        :disabled="!canPrevYear"
        @click="navigateYear(-1)"
      />
      <span class="whitespace-nowrap px-0.5 text-sm font-medium text-gray-700 dark:text-gray-300">
        {{ yearDisplayLabel }}
      </span>
      <UButton
        icon="i-heroicons-chevron-right"
        size="sm"
        variant="ghost"
        color="neutral"
        :disabled="!canNextYear"
        @click="navigateYear(1)"
      />
    </div>

    <!-- 自定义模式：双日期选择器 -->
    <div v-else-if="mode === 'custom'" class="flex items-center gap-1">
      <DatePicker v-model="customStartModel" width-class="w-28" :clearable="false" />
      <span class="text-xs text-gray-400">-</span>
      <DatePicker v-model="customEndModel" width-class="w-28" :clearable="false" />
    </div>
  </div>
</template>
