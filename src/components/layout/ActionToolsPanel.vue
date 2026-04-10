<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useLayoutStore } from '@/stores/layout'

const { t } = useI18n()
const layoutStore = useLayoutStore()
const { isToolsPanelLocked } = storeToRefs(layoutStore)

const isHovered = ref(false)
let hideTimer: ReturnType<typeof setTimeout> | null = null

const isVisible = computed(() => isToolsPanelLocked.value || isHovered.value)

function onMouseEnter() {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  isHovered.value = true
}

function onMouseLeave() {
  if (isToolsPanelLocked.value) return
  hideTimer = setTimeout(() => {
    isHovered.value = false
  }, 200)
}

const emit = defineEmits<{
  (e: 'openIncrementalImport'): void
  (e: 'openSessionIndex'): void
  (e: 'openMemberManagement'): void
  (e: 'openMessageExport'): void
}>()

function handleToolClick(event: (typeof tools)[number]['event']) {
  emit(event)
  if (!isToolsPanelLocked.value) {
    isHovered.value = false
  }
}

const tools = [
  { event: 'openIncrementalImport' as const, icon: 'i-heroicons-plus-circle', hoverColor: 'group-hover:text-pink-500', labelKey: 'analysis.tooltip.incrementalImport' },
  { event: 'openSessionIndex' as const, icon: 'i-heroicons-clock', hoverColor: 'group-hover:text-blue-500', labelKey: 'analysis.tooltip.sessionIndex' },
  { event: 'openMemberManagement' as const, icon: 'i-heroicons-user-group', hoverColor: 'group-hover:text-purple-500', labelKey: 'analysis.tooltip.memberManagement' },
  { event: 'openMessageExport' as const, icon: 'i-heroicons-document-arrow-down', hoverColor: 'group-hover:text-green-500', labelKey: 'analysis.messageExport.title' },
]
</script>

<template>
  <div
    class="fixed right-0 top-1/3 z-40"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <!-- Trigger 标签（面板隐藏时可见，面板展开时淡出） -->
    <div
      class="h-10 w-6 cursor-pointer items-center justify-center rounded-l-lg border border-r-0 border-gray-200 bg-white text-gray-400 shadow-sm transition-opacity duration-200 hover:bg-gray-50 hover:text-gray-600 dark:border-white/10 dark:bg-gray-800 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
      :class="isVisible ? 'pointer-events-none flex opacity-0' : 'flex opacity-100'"
    >
      <UIcon name="i-heroicons-wrench-screwdriver" class="h-3.5 w-3.5" />
    </div>

    <!-- 面板（覆盖在 trigger 上方，从右侧滑入） -->
    <div
      class="absolute right-0 top-0 transition-all duration-250 ease-in-out"
      :class="isVisible ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-full opacity-0'"
    >
      <div
        class="no-capture flex w-40 flex-col rounded-l-xl border border-r-0 border-gray-200/60 bg-white p-3 shadow-lg dark:border-white/5 dark:bg-gray-900"
      >
        <div class="mb-2 flex items-center justify-between">
          <span class="px-0.5 text-[9px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
            {{ t('analysis.overview.tools') }}
          </span>
          <UTooltip
            :text="isToolsPanelLocked ? t('analysis.toolsPanel.unlock') : t('analysis.toolsPanel.lock')"
            :popper="{ placement: 'left' }"
          >
            <button
              class="flex h-5 w-5 items-center justify-center rounded transition-colors"
              :class="isToolsPanelLocked
                ? 'text-pink-500 hover:text-pink-600 dark:text-pink-400'
                : 'text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400'"
              @click="layoutStore.toggleToolsPanelLock()"
            >
              <UIcon
                :name="isToolsPanelLocked ? 'i-heroicons-lock-closed-solid' : 'i-heroicons-lock-open'"
                class="h-3 w-3"
              />
            </button>
          </UTooltip>
        </div>

        <div class="flex flex-col gap-1.5">
          <button
            v-for="tool in tools"
            :key="tool.event"
            class="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 transition-all hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-white"
            @click="handleToolClick(tool.event)"
          >
            <UIcon
              :name="tool.icon"
              class="h-3.5 w-3.5 text-gray-400 transition-colors dark:text-gray-500"
              :class="tool.hoverColor"
            />
            <span class="whitespace-nowrap">{{ t(tool.labelKey) }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
