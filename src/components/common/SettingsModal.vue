<script setup lang="ts">
import { ref, computed, defineAsyncComponent, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import BasicSettingsTab from './Settings/BasicSettingsTab.vue'
import { usePromptStore } from '@/stores/prompt'
import { useLayoutStore } from '@/stores/layout'
import { IS_ELECTRON } from '@/utils/platform'
import SettingsDialogShell from './Settings/SettingsDialogShell.vue'
import { watchLazyOverlayVisibility } from './lazy-overlay-visibility'

const AISettingsTab = defineAsyncComponent(() => import('./Settings/AISettingsTab.vue'))
const BatchManageTab = defineAsyncComponent(() => import('./Settings/BatchManageTab.vue'))
const StorageTab = defineAsyncComponent(() => import('./Settings/StorageTab.vue'))
const AboutTab = defineAsyncComponent(() => import('./Settings/AboutTab.vue'))
const ApiSettingsTab = defineAsyncComponent(() => import('./Settings/ApiSettingsTab.vue'))
const SecuritySettingsTab = IS_ELECTRON
  ? defineAsyncComponent(() => import('./Settings/SecuritySettingsTab.vue'))
  : null

const { t } = useI18n()
const promptStore = usePromptStore()
const layoutStore = useLayoutStore()
const { showSettings, settingsTab, settingsSubTab } = storeToRefs(layoutStore)

interface ScrollableTab {
  scrollToSection?: (sectionId: string) => void
  refresh?: () => void
}

const tabs = computed(() => [
  { id: 'settings', label: t('settings.tabs.basic'), icon: 'i-heroicons-cog-6-tooth' },
  { id: 'ai', label: t('settings.tabs.ai'), icon: 'i-heroicons-sparkles' },
  { id: 'api', label: t('settings.tabs.api'), icon: 'i-heroicons-server-stack' },
  { id: 'data', label: t('settings.tabs.dataManage'), icon: 'i-heroicons-rectangle-stack' },
  { id: 'storage', label: t('settings.tabs.storage'), icon: 'i-heroicons-folder-open' },
  ...(IS_ELECTRON ? [{ id: 'security', label: t('settings.tabs.security'), icon: 'i-heroicons-shield-check' }] : []),
  { id: 'about', label: t('settings.tabs.about'), icon: 'i-heroicons-information-circle' },
])

const activeTab = ref('settings')

const tabRefs = ref<Record<string, ScrollableTab | null>>({})

function setTabRef(tabId: string, el: unknown) {
  tabRefs.value[tabId] = el as ScrollableTab | null
}

function handleAIConfigChanged() {
  promptStore.notifyAIConfigChanged()
}

function switchTab(tabId: string) {
  activeTab.value = tabId
  nextTick(() => {
    tabRefs.value[tabId]?.refresh?.()
  })
}

function scrollToSubTab(subTab: string) {
  const tabRef = tabRefs.value[activeTab.value]
  if (tabRef?.scrollToSection) {
    tabRef.scrollToSection(subTab)
  }
}

watchLazyOverlayVisibility(showSettings, async (visible) => {
  if (visible) {
    const requestedTab = settingsTab.value || 'settings'
    activeTab.value = tabs.value.some((tab) => tab.id === requestedTab) ? requestedTab : 'settings'
    if (settingsSubTab.value) {
      await nextTick()
      setTimeout(() => scrollToSubTab(settingsSubTab.value!), 100)
    }
    nextTick(() => {
      tabRefs.value[activeTab.value]?.refresh?.()
    })
  }
})
</script>

<template>
  <SettingsDialogShell v-model:open="showSettings" :active-tab="activeTab" :tabs="tabs" @update:active-tab="switchTab">
    <Transition name="tab-slide" mode="out-in">
      <div v-if="activeTab === 'settings'" key="settings" class="h-full">
        <BasicSettingsTab />
      </div>
      <AISettingsTab
        v-else-if="activeTab === 'ai'"
        key="ai"
        :ref="(el: unknown) => setTabRef('ai', el)"
        @config-changed="handleAIConfigChanged"
      />
      <BatchManageTab
        v-else-if="activeTab === 'data'"
        key="data"
        :focus-owner-issues="settingsSubTab === 'missing-owner'"
      />
      <ApiSettingsTab v-else-if="activeTab === 'api'" key="api" />
      <StorageTab v-else-if="activeTab === 'storage'" key="storage" :ref="(el: unknown) => setTabRef('storage', el)" />
      <SecuritySettingsTab v-else-if="IS_ELECTRON && activeTab === 'security'" key="security" />
      <div v-else-if="activeTab === 'about'" key="about" class="h-full overflow-y-auto">
        <AboutTab />
      </div>
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
