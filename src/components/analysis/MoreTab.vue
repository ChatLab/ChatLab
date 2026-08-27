<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { SectionTabs } from '@/components/navigation'
import { DebugTab } from '@/components/DebugTab'
import { trackProductEvent } from '@/services/product-analytics'
import { useSettingsStore } from '@/stores/settings'
import SQLLabTab from './SQLLabTab.vue'

const props = defineProps<{
  sessionId: string
  chatType?: 'group' | 'private'
}>()

const { t } = useI18n()
const route = useRoute()
const settingsStore = useSettingsStore()
const { debugMode } = storeToRefs(settingsStore)

const subTabs = computed(() => {
  const tabs = [
    {
      id: 'sql-lab',
      label: t('ai.tab.sqlLab'),
      icon: 'i-heroicons-command-line',
    },
  ]
  if (debugMode.value) {
    tabs.push({
      id: 'debug',
      label: t('analysis.tabs.debug'),
      icon: 'i-heroicons-bug-ant',
    })
  }
  return tabs
})

const savedSubTab = route.query.moreTab
const activeSubTab = ref(
  typeof savedSubTab === 'string' && subTabs.value.some((tab) => tab.id === savedSubTab) ? savedSubTab : 'sql-lab'
)

watch(
  activeSubTab,
  (tab) => {
    if (tab === 'sql-lab') trackProductEvent('feature_used', { feature_id: 'sql_lab' })
  },
  { immediate: true }
)

watch(debugMode, (enabled) => {
  if (!enabled && activeSubTab.value === 'debug') activeSubTab.value = 'sql-lab'
})
</script>

<template>
  <div class="flex h-full flex-col">
    <SectionTabs v-model="activeSubTab" :items="subTabs" persist-key="moreTab" />

    <div class="min-h-0 flex-1 overflow-hidden">
      <Transition name="fade" mode="out-in">
        <SQLLabTab
          v-if="activeSubTab === 'sql-lab'"
          class="h-full"
          :session-id="props.sessionId"
          :chat-type="props.chatType"
        />
        <DebugTab v-else-if="activeSubTab === 'debug'" class="h-full" :session-id="props.sessionId" />
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
