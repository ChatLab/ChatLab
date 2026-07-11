<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import PageHeader from '@/components/layout/PageHeader.vue'
import TimeSelect from '@/components/common/TimeSelect.vue'
import PageNavigation from '@/components/navigation/PageNavigation.vue'
import { provideAnnualSummaryTimeRange } from './annual-summary-time-range'

type InsightSubpage = 'annual-summary' | 'time-investment' | 'relationship-changes'

const { t } = useI18n()
const route = useRoute()
const timeRange = provideAnnualSummaryTimeRange()
const { modelValue, componentKey, initialState, rangeSource } = timeRange
const activeSubpage = computed<InsightSubpage>(() => {
  if (route.name === 'insight-time-investment') return 'time-investment'
  if (route.name === 'insight-relationship-changes') return 'relationship-changes'
  return 'annual-summary'
})
const navigationItems = computed(() => [
  {
    id: 'annual-summary',
    label: t('insight.tabs.annualSummary'),
    icon: 'i-lucide-calendar-range',
    to: { name: 'insight-annual-summary' },
  },
  {
    id: 'time-investment',
    label: t('insight.tabs.timeInvestment'),
    icon: 'i-lucide-clock-3',
    to: { name: 'insight-time-investment' },
  },
  {
    id: 'relationship-changes',
    label: t('insight.tabs.relationshipChanges'),
    icon: 'i-lucide-git-compare-arrows',
    to: { name: 'insight-relationship-changes' },
  },
])
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
      <PageNavigation
        class="mt-3 pb-1.5"
        :model-value="activeSubpage"
        :items="navigationItems"
        :aria-label="t('insight.tabs.nav')"
      >
        <template v-if="activeSubpage === 'annual-summary'" #right>
          <TimeSelect
            :key="componentKey"
            v-model="modelValue"
            :range-source="rangeSource"
            :allowed-modes="['recent', 'year']"
            :allowed-recent-days="[365]"
            :initial-state="initialState"
          />
        </template>
      </PageNavigation>
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
