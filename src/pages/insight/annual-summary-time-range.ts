import { computed, inject, provide, ref, type ComputedRef, type InjectionKey, type Ref } from 'vue'
import type { TimeRangeValue, TimeSelectRangeSource, TimeSelectState } from '@/components/common/TimeSelect.vue'

interface AnnualSummaryTimeRangeContext {
  modelValue: Ref<TimeRangeValue | null>
  componentKey: Ref<number>
  initialState: ComputedRef<Partial<TimeSelectState>>
  rangeSource: ComputedRef<TimeSelectRangeSource>
  setAvailableYears: (years: number[]) => void
  switchToYear: (year: number) => void
}

const ANNUAL_SUMMARY_TIME_RANGE_KEY: InjectionKey<AnnualSummaryTimeRangeContext> = Symbol('AnnualSummaryTimeRange')

export function provideAnnualSummaryTimeRange(): AnnualSummaryTimeRangeContext {
  const currentYear = new Date().getFullYear()
  const rangeEndTs = Math.floor(Date.now() / 1000)
  const modelValue = ref<TimeRangeValue | null>(null)
  const initialYear = ref(currentYear)
  const componentKey = ref(0)
  const availableYears = ref<number[]>([currentYear])
  const initialState = computed<Partial<TimeSelectState>>(() => ({ mode: 'year', year: initialYear.value }))
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

  const context = { modelValue, componentKey, initialState, rangeSource, setAvailableYears, switchToYear }
  provide(ANNUAL_SUMMARY_TIME_RANGE_KEY, context)
  return context
}

export function useAnnualSummaryTimeRange(): AnnualSummaryTimeRangeContext {
  const context = inject(ANNUAL_SUMMARY_TIME_RANGE_KEY)
  if (!context) throw new Error('Annual summary time range context is unavailable')
  return context
}
