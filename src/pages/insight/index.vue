<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import PageHeader from '@/components/layout/PageHeader.vue'
import TimeSelect from '@/components/common/TimeSelect.vue'
import InsightSubnav from './components/InsightSubnav.vue'
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
</script>

<template>
  <div
    class="flex h-full flex-col bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100"
    style="padding-top: var(--titlebar-area-height)"
  >
    <PageHeader
      :title="t('insight.title')"
      icon="i-heroicons-presentation-chart-bar"
      icon-class="bg-pink-600 text-white dark:bg-pink-500 dark:text-white"
      size="compact"
    >
      <div class="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1.5">
        <InsightSubnav :active="activeSubpage" class="w-full sm:w-auto" />
        <div
          v-if="activeSubpage === 'annual-summary'"
          class="flex overflow-x-auto scrollbar-hide w-full sm:w-auto justify-start sm:justify-end"
        >
          <TimeSelect
            :key="componentKey"
            v-model="modelValue"
            :range-source="rangeSource"
            :allowed-modes="['recent', 'year']"
            :allowed-recent-days="[365]"
            :initial-state="initialState"
          />
        </div>
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
