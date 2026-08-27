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
import { trackProductEvent } from '@/services/product-analytics'

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
  const isSessionSwitching = ref(true)
  const session = ref<AnalysisSession | null>(null)
  const memberActivity = ref<MemberActivity[]>([])
  const hourlyActivity = ref<HourlyActivity[]>([])
  const dailyActivity = ref<DailyActivity[]>([])
  const messageTypes = ref<Array<{ type: MessageType; count: number }>>([])
  let baseLoadVersion = 0
  let analysisLoadVersion = 0
  let baseDataReady = false
  let analysisDataReady = false
  let loadedAnalysisScopeKey: string | null = null

  function getAnalysisScopeKey(): string | null {
    const sessionId = currentSessionId.value
    if (!sessionId) return null
    const filter = timeFilter.value
    return filter ? `${sessionId}:${filter.startTs}:${filter.endTs}` : `${sessionId}:all`
  }

  function finishSessionSwitchIfReady() {
    if (!isSessionSwitching.value || !baseDataReady) return
    if (!session.value || analysisDataReady) isSessionSwitching.value = false
  }

  function resolveActiveTabFromRoute(): string {
    const routeTab = route.query.tab as string | undefined
    if (routeTab && validTabIds.includes(routeTab)) return routeTab
    return defaultTab
  }

  const activeTab = ref(resolveActiveTabFromRoute())
  const activeTabUsesOverviewAnalytics = computed(() => activeTab.value === 'insights')
  const activeTabUsesTimeRange = computed(() => ['insights', 'ranking'].includes(activeTab.value))

  watch(
    activeTab,
    (tab) => {
      const featureId = {
        insights: 'insights',
        ranking: 'ranking',
        'ai-chat': 'ai_chat',
      }[tab]
      if (featureId) trackProductEvent('feature_used', { feature_id: featureId })
    },
    { immediate: true }
  )

  const { timeRangeValue, fullTimeRange, availableYears, timeFilter, initialTimeState, resetTimeRange } = useTimeSelect(
    route,
    router,
    {
      activeTab,
      isInitialLoad,
      currentSessionId,
      onTimeRangeChange: () => loadAnalysisData(),
    }
  )

  function syncSession() {
    const id = route.params.id as string
    if (id) {
      selectSession(id)
      if (currentSessionId.value !== id) {
        router.replace('/')
      }
    }
  }

  async function loadAnalysisData() {
    const sessionId = currentSessionId.value
    if (!sessionId) return

    const loadVersion = ++analysisLoadVersion
    const analysisScopeKey = getAnalysisScopeKey()
    if (!activeTabUsesOverviewAnalytics.value) {
      isLoading.value = false
      analysisDataReady = true
      finishSessionSwitchIfReady()
      return
    }

    if (isSessionSwitching.value) analysisDataReady = false
    isLoading.value = true

    try {
      const filter = timeFilter.value

      const adapter = useDataService()
      const [members, hourly, daily, types] = await Promise.all([
        adapter.getMemberActivity(sessionId, filter),
        adapter.getHourlyActivity(sessionId, filter),
        adapter.getDailyActivity(sessionId, filter),
        adapter.getMessageTypeDistribution(sessionId, filter),
      ])

      // Browser Runtime 查询无法被 HTTP epoch 取消，旧批次完成时不得覆盖最新筛选结果。
      if (loadVersion !== analysisLoadVersion) return
      memberActivity.value = members
      hourlyActivity.value = hourly
      dailyActivity.value = daily
      messageTypes.value = types
      loadedAnalysisScopeKey = analysisScopeKey
    } catch (error) {
      if (loadVersion === analysisLoadVersion) {
        console.error('加载分析数据失败:', error)
      }
    } finally {
      if (loadVersion === analysisLoadVersion) {
        isLoading.value = false
        analysisDataReady = true
        finishSessionSwitchIfReady()
      }
    }
  }

  function handleTimeRangeInitialized(hasRange: boolean) {
    if (hasRange) return
    timeRangeValue.value = null
    void loadAnalysisData()
  }

  async function loadData() {
    const sessionId = currentSessionId.value
    if (!sessionId) return

    const loadVersion = ++baseLoadVersion
    isInitialLoad.value = true
    try {
      const sessionData = await useDataService().getSession(sessionId)
      if (loadVersion !== baseLoadVersion || currentSessionId.value !== sessionId) return
      session.value = sessionData
    } catch (error) {
      if (loadVersion === baseLoadVersion && currentSessionId.value === sessionId) {
        session.value = null
        console.error('加载基础数据失败:', error)
      }
    } finally {
      if (loadVersion === baseLoadVersion && currentSessionId.value === sessionId) {
        isInitialLoad.value = false
        baseDataReady = true
        finishSessionSwitchIfReady()
      }
    }
  }

  watch(activeTab, () => {
    if (!activeTabUsesOverviewAnalytics.value) {
      analysisLoadVersion++
      abortAnalyticsRequests()
      isLoading.value = false
      if (!activeTabUsesTimeRange.value) {
        analysisDataReady = true
        finishSessionSwitchIfReady()
      }
      return
    }

    const analysisScopeKey = getAnalysisScopeKey()
    if (analysisScopeKey && analysisScopeKey === loadedAnalysisScopeKey) {
      isLoading.value = false
      analysisDataReady = true
      finishSessionSwitchIfReady()
      return
    }

    isLoading.value = true
    if (currentSessionId.value && timeRangeValue.value) void loadAnalysisData()
  })

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
      analysisLoadVersion++
      loadedAnalysisScopeKey = null
      resetTimeRange()
      baseDataReady = false
      analysisDataReady = !activeTabUsesTimeRange.value
      isLoading.value = activeTabUsesOverviewAnalytics.value
      isSessionSwitching.value = true
      // 切换会话时，上一会话的分析请求立即作废（切换后子 Tab 会按新 key 重挂并重新取数）。
      abortAnalyticsRequests()
      void loadData()
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
    isSessionSwitching,
    session,
    memberActivity,
    hourlyActivity,
    dailyActivity,
    messageTypes,
    timeRangeValue,
    fullTimeRange,
    availableYears,
    timeFilter,
    initialTimeState,
    syncSession,
    loadData,
    loadAnalysisData,
    handleTimeRangeInitialized,
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
