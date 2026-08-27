<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import PageHeader from '@/components/layout/PageHeader.vue'
import TimeSelect, { type TimeSelectMode } from '@/components/common/TimeSelect.vue'
import { PageTabs } from '@/components/navigation'
import { listInsightShellPages } from '@/plugins/insight-catalog'
import { InsightScopeController } from '@/plugins/insight-scope'
import { useHostLocale, useInsightPluginRuntime } from '@/plugins/insight-vue'
import { useNavigationLayout } from '@/navigation/vue'
import { createInsightTimeRange, getInsightTimeFilterSignature } from './insight-time-range'

const { t } = useI18n()
const { translate } = useHostLocale()
const route = useRoute()
const pluginRuntime = useInsightPluginRuntime()
const { controller: navigationLayoutController, snapshot: navigationLayoutSnapshot } = useNavigationLayout()
const pages = listInsightShellPages(pluginRuntime)
const activeSubpage = computed(() => String(route.meta.insightPageId ?? pages[0]?.id ?? ''))
const activePage = computed(() => pages.find((page) => page.id === activeSubpage.value))
const timeFilter = computed(() => activePage.value?.filters?.time)
const defaultTimeMode = computed<TimeSelectMode>(() => timeFilter.value?.defaultMode ?? 'year')
const allowedTimeModes = computed(() =>
  timeFilter.value ? ([...timeFilter.value.allowedModes] as TimeSelectMode[]) : undefined
)
const timeRange = createInsightTimeRange(defaultTimeMode, allowedTimeModes)
const { modelValue, componentKey, initialState, rangeSource } = timeRange
const insightScope = pluginRuntime.ui.insightScope
if (!(insightScope instanceof InsightScopeController)) throw new Error('Insight scope host controller is unavailable')
const detachTimeCommands = insightScope.attachTimeCommands({
  setAvailableYears: timeRange.setAvailableYears,
  switchToYear: timeRange.switchToYear,
})
const stopSyncingScope = watch(
  [modelValue, timeFilter],
  ([value, filter]) => {
    const state = value?.state
    insightScope.updateSnapshot({
      time:
        value && state && filter?.allowedModes.includes(state.mode)
          ? {
              mode: state.mode,
              startTs: value.startTs,
              endTs: value.endTs,
              isFullRange: value.isFullRange,
              recentDays: state.recentDays,
              year: state.year,
              quarterYear: state.quarterYear,
              quarter: state.quarter,
              customStart: state.customStart,
              customEnd: state.customEnd,
            }
          : undefined,
    })
  },
  { immediate: true }
)
const resolvedNavigation = computed(() => {
  void navigationLayoutSnapshot.value.revision
  return navigationLayoutController.getResolvedLayout()
})
const activeNavigationGroup = computed(() =>
  resolvedNavigation.value.primary.find(
    (item) => item.kind === 'group' && item.entries.some(({ page }) => page.id === activeSubpage.value)
  )
)
const navigationItems = computed(() =>
  (activeNavigationGroup.value?.kind === 'group' ? activeNavigationGroup.value.entries : []).map(({ page }) => ({
    id: page.id,
    label: translate(page.title),
    icon: page.icon,
    to: { name: page.routeName },
  }))
)
const allowedRecentDays = computed(() =>
  timeFilter.value?.allowedRecentDays ? [...timeFilter.value.allowedRecentDays] : undefined
)
const timeFilterSignature = computed(() => {
  const filter = timeFilter.value
  return filter ? getInsightTimeFilterSignature(filter) : 'none'
})

onBeforeUnmount(() => {
  stopSyncingScope()
  detachTimeCommands()
  insightScope.updateSnapshot({})
})
</script>

<template>
  <div
    class="flex h-full flex-col text-gray-900 dark:bg-page-dark dark:text-gray-100"
    style="padding-top: var(--titlebar-area-height)"
  >
    <PageHeader
      :title="t('insight.title')"
      icon="i-heroicons-presentation-chart-bar"
      icon-class="bg-pink-600 text-white dark:bg-pink-500 dark:text-white"
      size="compact"
    >
      <PageTabs
        v-if="navigationItems.length > 0"
        class="mt-3 min-h-[38px] pb-1.5"
        :model-value="activeSubpage"
        :items="navigationItems"
        :aria-label="t('insight.tabs.nav')"
      >
        <template v-if="timeFilter" #right>
          <TimeSelect
            :key="`${componentKey}:${timeFilterSignature}`"
            v-model="modelValue"
            :range-source="rangeSource"
            :allowed-modes="allowedTimeModes"
            :allowed-recent-days="allowedRecentDays"
            :initial-state="initialState"
          />
        </template>
      </PageTabs>
      <div v-else-if="timeFilter" class="mt-3 flex justify-end pb-1.5">
        <TimeSelect
          :key="`${componentKey}:${timeFilterSignature}`"
          v-model="modelValue"
          :range-source="rangeSource"
          :allowed-modes="allowedTimeModes"
          :allowed-recent-days="allowedRecentDays"
          :initial-state="initialState"
        />
      </div>
    </PageHeader>

    <RouterView v-slot="{ Component }">
      <Transition name="insight-tab-slide" mode="out-in">
        <component :is="Component" :key="activeSubpage" />
      </Transition>
    </RouterView>
  </div>
</template>

<style scoped>
.insight-tab-slide-enter-active,
.insight-tab-slide-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.insight-tab-slide-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.insight-tab-slide-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
