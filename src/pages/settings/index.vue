<script setup lang="ts">
import { ref, watch, onMounted, computed, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import PageHeader from '@/components/layout/PageHeader.vue'
import AISettingsTab from './components/AISettingsTab.vue'
import BasicSettingsTab from './components/BasicSettingsTab.vue'
import BatchManageTab from './components/BatchManageTab.vue'
import StorageTab from './components/StorageTab.vue'
import AboutTab from './components/AboutTab.vue'
import { usePromptStore } from '@/stores/prompt'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const promptStore = usePromptStore()

interface ScrollableTab {
  scrollToSection?: (sectionId: string) => void
  refresh?: () => void
}

const tabs = computed(() => [
  { id: 'settings', label: t('settings.tabs.basic'), icon: 'i-heroicons-cog-6-tooth' },
  { id: 'ai', label: t('settings.tabs.ai'), icon: 'i-heroicons-sparkles' },
  { id: 'data', label: t('settings.tabs.dataManage'), icon: 'i-heroicons-rectangle-stack' },
  { id: 'storage', label: t('settings.tabs.storage'), icon: 'i-heroicons-folder-open' },
  { id: 'about', label: t('settings.tabs.about'), icon: 'i-heroicons-information-circle' },
])

const activeTab = ref((route.query.tab as string) || 'settings')

const tabRefs = ref<Record<string, ScrollableTab | null>>({})

function setTabRef(tabId: string, el: unknown) {
  tabRefs.value[tabId] = el as ScrollableTab | null
}

function handleAIConfigChanged() {
  promptStore.notifyAIConfigChanged()
}

function switchTab(tabId: string) {
  activeTab.value = tabId
  const query: Record<string, string> = { tab: tabId }
  router.replace({ query })

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

watch(
  () => route.query,
  async (query) => {
    const tab = (query.tab as string) || 'settings'
    if (tab !== activeTab.value) {
      activeTab.value = tab
    }
    const subTab = query.subTab as string
    if (subTab) {
      await nextTick()
      setTimeout(() => scrollToSubTab(subTab), 100)
    }
  }
)

onMounted(async () => {
  const subTab = route.query.subTab as string
  if (subTab) {
    await nextTick()
    setTimeout(() => scrollToSubTab(subTab), 100)
  }
  tabRefs.value[activeTab.value]?.refresh?.()
})
</script>

<template>
  <div class="flex h-full flex-col bg-white dark:bg-gray-900" style="padding-top: var(--titlebar-area-height)">
    <PageHeader
      :title="t('settings.title')"
      icon="i-heroicons-cog-6-tooth"
      icon-class="bg-primary-600 text-white dark:bg-primary-500 dark:text-white"
    >
      <div class="mt-4 flex items-center gap-1 overflow-x-auto scrollbar-hide">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all"
          :class="[
            activeTab === tab.id
              ? 'bg-pink-500 text-white dark:bg-pink-900/30 dark:text-pink-300'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800',
          ]"
          @click="switchTab(tab.id)"
        >
          <UIcon :name="tab.icon" class="h-4 w-4" />
          <span class="whitespace-nowrap">{{ tab.label }}</span>
        </button>
      </div>
    </PageHeader>

    <div class="relative flex-1 overflow-y-auto">
      <div class="h-full p-6">
        <Transition name="tab-slide" mode="out-in">
          <BasicSettingsTab v-if="activeTab === 'settings'" key="settings" />
          <AISettingsTab
            v-else-if="activeTab === 'ai'"
            key="ai"
            :ref="(el) => setTabRef('ai', el)"
            @config-changed="handleAIConfigChanged"
          />
          <BatchManageTab v-else-if="activeTab === 'data'" key="data" />
          <StorageTab v-else-if="activeTab === 'storage'" key="storage" :ref="(el) => setTabRef('storage', el)" />
          <AboutTab v-else-if="activeTab === 'about'" key="about" />
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
