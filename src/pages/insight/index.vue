<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import PageHeader from '@/components/layout/PageHeader.vue'
import EmptyState from '@/components/UI/EmptyState.vue'

const { t } = useI18n()

const tabs = [
  { id: 'overview', labelKey: 'insight.tabs.overview', icon: 'i-heroicons-chart-pie' },
  { id: 'trends', labelKey: 'insight.tabs.trends', icon: 'i-heroicons-presentation-chart-line' },
  { id: 'ranking', labelKey: 'insight.tabs.ranking', icon: 'i-heroicons-trophy' },
]

const activeTab = ref('overview')
</script>

<template>
  <div class="flex h-full flex-col bg-white dark:bg-gray-900" style="padding-top: var(--titlebar-area-height)">
    <PageHeader
      :title="t('insight.title')"
      icon="i-heroicons-presentation-chart-bar"
      icon-class="bg-pink-600 text-white dark:bg-pink-500 dark:text-white"
      size="compact"
    >
      <!-- Tab 栏 -->
      <div class="mt-3 flex items-center gap-0.5 overflow-x-auto scrollbar-hide">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-all"
          :class="[
            activeTab === tab.id
              ? 'bg-pink-500 text-white dark:bg-pink-900/30 dark:text-pink-300'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800',
          ]"
          @click="activeTab = tab.id"
        >
          <UIcon :name="tab.icon" class="h-4 w-4" />
          <span class="whitespace-nowrap">{{ t(tab.labelKey) }}</span>
        </button>
      </div>
    </PageHeader>

    <!-- Tab 内容区 -->
    <div class="relative flex-1 overflow-y-auto">
      <div class="h-full">
        <Transition name="tab-slide" mode="out-in">
          <div :key="activeTab" class="flex h-full items-center justify-center">
            <EmptyState :text="t('insight.placeholder')" icon="✨" padding="lg" />
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tab-slide-enter-active,
.tab-slide-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.tab-slide-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.tab-slide-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
