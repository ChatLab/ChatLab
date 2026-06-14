import { ref, watch, onMounted, computed } from 'vue'
import type { Ref } from 'vue'
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router'
import type { AnalysisSession, MessageType } from '@/types/base'
import type { MemberActivity, HourlyActivity, DailyActivity } from '@/types/analysis'
import { useI18n } from 'vue-i18n'
import { formatLocalizedDate } from '@/utils'
import { useTimeSelect } from './useTimeSelect'
import { useDataService } from '@/services'
import { abortAnalyticsRequests } from '@/services/utils/http'

interface UseSessionAnalysisPageBaseOptions {
  route: RouteLocationNormalizedLoaded
  router: Router
  currentSessionId: Ref<string | null>
  selectSession: (id: string) => void
  defaultTab: string
  validTabIds: string[]
}

interface UseSessionHeaderDescriptionOptions {
  session: Ref<AnalysisSession | null>
  fullTimeRange: Ref<{ start: number; end: number } | null>
  timeRangeValue: Ref<{ startTs: number } | null>
  descriptionKey: string
}

export function useSessionAnalysisPageBase(options: UseSessionAnalysisPageBaseOptions) {
  const { route, router, currentSessionId, selectSession, defaultTab, validTabIds } = options

  const isLoading = ref(true)
  const isInitialLoad = ref(true)
  const session = ref<AnalysisSession | null>(null)
  const memberActivity = ref<MemberActivity[]>([])
  const hourlyActivity = ref<HourlyActivity[]>([])
  const dailyActivity = ref<DailyActivity[]>([])
  const messageTypes = ref<Array<{ type: MessageType; count: number }>>([])

  function resolveActiveTabFromRoute(): string {
    const routeTab = route.query.tab as string | undefined
    if (routeTab && validTabIds.includes(routeTab)) return routeTab
    return defaultTab
  }

  const activeTab = ref(resolveActiveTabFromRoute())

  const { timeRangeValue, fullTimeRange, availableYears, timeFilter, selectedYearForOverview, initialTimeState } =
    useTimeSelect(route, router, {
      activeTab,
      isInitialLoad,
      currentSessionId,
      onTimeRangeChange: () => loadAnalysisData(),
    })

  function syncSession() {
    const id = route.params.id as string
    if (id) {
      selectSession(id)
      if (currentSessionId.value !== id) {
        router.replace('/')
      }
    }
  }

  async function loadBaseData() {
    if (!currentSessionId.value) return

    try {
      const sessionData = await useDataService().getSession(currentSessionId.value)
      session.value = sessionData
    } catch (error) {
      console.error('加载基础数据失败:', error)
    }
  }

  async function loadAnalysisData() {
    if (!currentSessionId.value) return

    isLoading.value = true

    try {
      const filter = timeFilter.value

      const adapter = useDataService()
      const [members, hourly, daily, types] = await Promise.all([
        adapter.getMemberActivity(currentSessionId.value, filter),
        adapter.getHourlyActivity(currentSessionId.value, filter),
        adapter.getDailyActivity(currentSessionId.value, filter),
        adapter.getMessageTypeDistribution(currentSessionId.value, filter),
      ])

      memberActivity.value = members
      hourlyActivity.value = hourly
      dailyActivity.value = daily
      messageTypes.value = types
    } catch (error) {
      console.error('加载分析数据失败:', error)
    } finally {
      isLoading.value = false
    }
  }

  async function loadData() {
    if (!currentSessionId.value) return

    isInitialLoad.value = true
    await loadBaseData()
    isInitialLoad.value = false
  }

  watch(
    () => route.params.id,
    () => {
      activeTab.value = resolveActiveTabFromRoute()
      syncSession()
    }
  )

  watch(
    () => route.query.tab,
    () => {
      activeTab.value = resolveActiveTabFromRoute()
    }
  )

  watch(
    currentSessionId,
    () => {
      // 切换会话时，上一会话的分析请求立即作废（切换后子 Tab 会按新 key 重挂并重新取数）。
      abortAnalyticsRequests()
      loadData()
    },
    { immediate: true }
  )

  onMounted(() => {
    syncSession()
  })

  return {
    activeTab,
    isLoading,
    isInitialLoad,
    session,
    memberActivity,
    hourlyActivity,
    dailyActivity,
    messageTypes,
    timeRangeValue,
    fullTimeRange,
    availableYears,
    timeFilter,
    selectedYearForOverview,
    initialTimeState,
    syncSession,
    loadData,
    loadAnalysisData,
  }
}

export function useSessionHeaderDescription(options: UseSessionHeaderDescriptionOptions) {
  const { session, fullTimeRange, timeRangeValue, descriptionKey } = options
  const { t, locale } = useI18n()

  const headerStartDate = computed(() => {
    const startTs = fullTimeRange.value?.start ?? timeRangeValue.value?.startTs
    const fallbackTs = Math.floor(Date.now() / 1000)
    return formatLocalizedDate(startTs ?? fallbackTs, locale.value)
  })

  const headerEndDate = computed(() => formatLocalizedDate(Math.floor(Date.now() / 1000), locale.value))

  const headerDescription = computed(() =>
    t(descriptionKey, {
      startDate: headerStartDate.value,
      endDate: headerEndDate.value,
      messageCount: session.value?.messageCount ?? 0,
    })
  )

  return {
    headerDescription,
    headerStartDate,
    headerEndDate,
  }
}
