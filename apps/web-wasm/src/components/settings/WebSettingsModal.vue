<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import BasicSettingsTab from '@/components/common/Settings/BasicSettingsTab.vue'
import SettingsDialogShell from '@/components/common/Settings/SettingsDialogShell.vue'
import { useLayoutStore } from '@/stores/layout'

const WebAISettingsTab = defineAsyncComponent(() => import('./WebAISettingsTab.vue'))

const { t } = useI18n()
const layoutStore = useLayoutStore()
const { showSettings, settingsTab } = storeToRefs(layoutStore)
const activeTab = ref('settings')
const tabs = computed(() => [
  { id: 'settings', label: t('settings.tabs.basic'), icon: 'i-heroicons-cog-6-tooth' },
  { id: 'ai', label: t('settings.tabs.ai'), icon: 'i-heroicons-sparkles' },
])

watch(showSettings, (visible) => {
  if (!visible) return
  activeTab.value = tabs.value.some((tab) => tab.id === settingsTab.value) ? settingsTab.value : 'settings'
})
</script>

<template>
  <SettingsDialogShell v-model:open="showSettings" v-model:active-tab="activeTab" :tabs="tabs">
    <Transition name="tab-slide" mode="out-in">
      <BasicSettingsTab v-if="activeTab === 'settings'" key="settings" :show-tools-panel="false" />
      <WebAISettingsTab v-else key="ai" />
    </Transition>
  </SettingsDialogShell>
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
