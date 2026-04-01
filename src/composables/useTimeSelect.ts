/**
 * useTimeSelect — 管理 TimeSelect 组件的状态、派生计算与 URL 同步
 *
 * 从 private-chat/index.vue 和 group-chat/index.vue 中提取的共通逻辑，
 * 消除两个页面间 ~50 行重复代码。
 */
import { ref, computed, watch } from 'vue'
import type { Ref } from 'vue'
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router'
import type { TimeRangeValue, TimeSelectState, TimeSelectMode } from '@/components/common/TimeSelect.vue'

interface UseTimeSelectOptions {
  /** 当前激活的 Tab ref（用于 URL 同步） */
  activeTab: Ref<string>
  /** 是否处于初始加载（URL 同步 guard） */
  isInitialLoad: Ref<boolean>
  /** 当前会话 ID ref（用于 timeRangeValue watch guard） */
  currentSessionId: Ref<string | null>
  /** timeRangeValue 变化时的回调（通常用于重新加载分析数据） */
  onTimeRangeChange?: () => void
}

export function useTimeSelect(route: RouteLocationNormalizedLoaded, router: Router, options: UseTimeSelectOptions) {
  const { activeTab, isInitialLoad, currentSessionId, onTimeRangeChange } = options

  // ==================== 核心状态 ====================

  /** TimeSelect v-model 绑定值 */
  const timeRangeValue = ref<TimeRangeValue | null>(null)

  /** 完整时间范围（由 TimeSelect 通过 emit 设置） */
  const fullTimeRange = ref<{ start: number; end: number } | null>(null)

  /** 可选年份列表（由 TimeSelect 通过 emit 设置，group-chat 的 ViewTab 需要） */
  const availableYears = ref<number[]>([])

  // ==================== 派生计算 ====================

  /** 时间过滤参数（用于 API 调用） */
  const timeFilter = computed(() => {
    const v = timeRangeValue.value
    if (!v) return undefined
    return { startTs: v.startTs, endTs: v.endTs }
  })

  /** Tab 内容 key（确保时间筛选切换时组件能正确刷新） */
  const timeFilterKey = computed(() => {
    const v = timeRangeValue.value
    if (!v) return 'init'
    return `${v.startTs}-${v.endTs}`
  })

  /** 用于 OverviewTab / ViewTab 的 selectedYear（null=全部，number=指定年份） */
  const selectedYearForOverview = computed(() => {
    const v = timeRangeValue.value
    if (!v || v.isFullRange) return null
    return new Date(v.startTs * 1000).getFullYear()
  })

  /** 从 URL query 构建 TimeSelect 初始状态 */
  const initialTimeState = computed<Partial<TimeSelectState>>(() => {
    const q = route.query
    const m = q.timeMode as TimeSelectMode | undefined
    return {
      mode: m ?? undefined,
      recentDays: q.timeDays ? Number(q.timeDays) : undefined,
      year: q.timeYear ? Number(q.timeYear) : undefined,
      quarterYear: q.timeYear ? Number(q.timeYear) : undefined,
      quarter: q.timeQuarter ? Number(q.timeQuarter) : undefined,
      customStart: (q.timeStart as string) || undefined,
      customEnd: (q.timeEnd as string) || undefined,
    }
  })

  // ==================== URL 同步 ====================

  watch([activeTab, timeRangeValue], ([newTab, newTimeRange]) => {
    if (isInitialLoad.value || !newTimeRange) return

    const state = (newTimeRange as TimeRangeValue).state
    const query: Record<string, string | number | undefined> = {
      tab: newTab as string,
      timeMode: state.mode,
    }
    if (state.mode === 'recent') query.timeDays = state.recentDays
    if (state.mode === 'year') query.timeYear = state.year
    if (state.mode === 'quarter') {
      query.timeYear = state.quarterYear
      query.timeQuarter = state.quarter
    }
    if (state.mode === 'custom') {
      query.timeStart = state.customStart
      query.timeEnd = state.customEnd
    }

    router.replace({ query })
  })

  // ==================== timeRangeValue 变化监听 ====================

  watch(
    timeRangeValue,
    (val) => {
      if (!val || !currentSessionId.value) return
      onTimeRangeChange?.()
    },
    { immediate: true }
  )

  // ==================== 重置方法 ====================

  /** 切换会话时调用，清空时间范围状态 */
  function resetTimeRange() {
    timeRangeValue.value = null
    fullTimeRange.value = null
    availableYears.value = []
  }

  return {
    // 状态
    timeRangeValue,
    fullTimeRange,
    availableYears,
    // 派生计算
    timeFilter,
    timeFilterKey,
    selectedYearForOverview,
    initialTimeState,
    // 方法
    resetTimeRange,
  }
}
