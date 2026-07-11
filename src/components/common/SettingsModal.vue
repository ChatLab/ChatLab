<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import AISettingsTab from './Settings/AISettingsTab.vue'
import BasicSettingsTab from './Settings/BasicSettingsTab.vue'
import BatchManageTab from './Settings/BatchManageTab.vue'
import StorageTab from './Settings/StorageTab.vue'
import AboutTab from './Settings/AboutTab.vue'
import ApiSettingsTab from './Settings/ApiSettingsTab.vue'
import { PageTabs } from '@/components/navigation'
import { usePromptStore } from '@/stores/prompt'
import { useLayoutStore } from '@/stores/layout'

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

watch(showSettings, async (visible) => {
  if (visible) {
    activeTab.value = settingsTab.value || 'settings'
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
  <UModal
    v-model:open="showSettings"
    :ui="{
      content: 'sm:max-w-[900px] z-[100]',
      overlay: 'z-[99] bg-gray-200/80 backdrop-blur-sm dark:bg-page-dark/80',
    }"
  >
    <template #content>
      <div class="flex min-h-[650px] h-[85vh] flex-col overflow-hidden">
        <!-- Header -->
        <div class="shrink-0 border-b border-gray-200 px-6 pt-5 pb-0 dark:border-gray-800">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 dark:bg-primary-500">
                <UIcon name="i-heroicons-cog-6-tooth" class="h-4 w-4 text-white" />
              </div>
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
                {{ t('settings.title') }}
              </h2>
            </div>
            <UButton
              icon="i-heroicons-x-mark"
              color="neutral"
              variant="ghost"
              size="sm"
              @click="layoutStore.closeSettings()"
            />
          </div>
          <!-- Tabs -->
          <PageTabs v-model="activeTab" class="mt-4 pb-3" :items="tabs" @change="switchTab" />
        </div>

        <div class="relative flex-1">
          <div class="absolute inset-0 p-6">
            <Transition name="tab-slide" mode="out-in">
              <div v-if="activeTab === 'settings'" key="settings" class="h-full overflow-y-auto">
                <BasicSettingsTab />
              </div>
              <AISettingsTab
                v-else-if="activeTab === 'ai'"
                key="ai"
                :ref="(el: unknown) => setTabRef('ai', el)"
                @config-changed="handleAIConfigChanged"
              />
              <BatchManageTab v-else-if="activeTab === 'data'" key="data" />
              <ApiSettingsTab v-else-if="activeTab === 'api'" key="api" />
              <StorageTab
                v-else-if="activeTab === 'storage'"
                key="storage"
                :ref="(el: unknown) => setTabRef('storage', el)"
              />
              <div v-else-if="activeTab === 'about'" key="about" class="h-full overflow-y-auto">
                <AboutTab />
              </div>
            </Transition>
          </div>
        </div>
      </div>
    </template>
  </UModal>
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
