import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type {
  TimeRangeValue,
  TimeSelectMode,
  TimeSelectRangeSource,
  TimeSelectState,
} from '@/components/common/TimeSelect.vue'

interface InsightTimeRangeContext {
  modelValue: Ref<TimeRangeValue | null>
  componentKey: Ref<number>
  initialState: ComputedRef<Partial<TimeSelectState>>
  rangeSource: ComputedRef<TimeSelectRangeSource>
  setAvailableYears: (years: number[]) => void
  switchToYear: (year: number) => void
}

export function resolveInsightTimeInitialState(
  value: TimeRangeValue | null,
  defaultMode: TimeSelectMode,
  allowedModes: readonly TimeSelectMode[] | undefined,
  initialYear: number
): Partial<TimeSelectState> {
  const state = value?.state
  if (state && (!allowedModes || allowedModes.includes(state.mode))) return { ...state }
  return { mode: defaultMode, year: initialYear }
}

export function getInsightTimeFilterSignature(filter: {
  defaultMode: TimeSelectMode
  allowedModes: readonly TimeSelectMode[]
  allowedRecentDays?: readonly number[]
}): string {
  return [filter.defaultMode, filter.allowedModes.join(','), filter.allowedRecentDays?.join(',')].join(':')
}

export function createInsightTimeRange(
  defaultMode?: Readonly<Ref<TimeSelectMode>>,
  allowedModes?: Readonly<Ref<readonly TimeSelectMode[] | undefined>>
): InsightTimeRangeContext {
  const currentYear = new Date().getFullYear()
  const rangeEndTs = Math.floor(Date.now() / 1000)
  const modelValue = ref<TimeRangeValue | null>(null)
  const initialYear = ref(currentYear)
  const componentKey = ref(0)
  const availableYears = ref<number[]>([currentYear])
  const initialState = computed<Partial<TimeSelectState>>(() =>
    resolveInsightTimeInitialState(
      modelValue.value,
      defaultMode?.value ?? 'year',
      allowedModes?.value,
      initialYear.value
    )
  )
  const rangeSource = computed<TimeSelectRangeSource>(() => {
    const oldestYear = availableYears.value.at(-1) ?? currentYear
    return {
      availableYears: availableYears.value,
      fullRange: {
        start: Math.floor(new Date(oldestYear, 0, 1).getTime() / 1000),
        end: rangeEndTs,
      },
    }
  })

  function setAvailableYears(years: number[]): void {
    const next = [...new Set([currentYear, ...years])].sort((a, b) => b - a)
    if (next.join(',') !== availableYears.value.join(',')) availableYears.value = next
  }

  function switchToYear(year: number): void {
    initialYear.value = year
    modelValue.value = null
    componentKey.value++
  }

  return { modelValue, componentKey, initialState, rangeSource, setAvailableYears, switchToYear }
}
