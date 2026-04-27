<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useLayoutStore } from '@/stores/layout'

const { t } = useI18n()
const layoutStore = useLayoutStore()
const { isToolsPanelLocked, isToolsPanelMini, toolsPanelPosition, isToolsPanelOpen } = storeToRefs(layoutStore)

const isHeaderMode = computed(() => toolsPanelPosition.value === 'header')

const isHovered = ref(false)
let hideTimer: ReturnType<typeof setTimeout> | null = null

const isVisible = computed(() => {
  if (isHeaderMode.value) return isToolsPanelOpen.value
  return isToolsPanelLocked.value || isHovered.value
})

function onMouseEnter() {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  if (!isHeaderMode.value) {
    isHovered.value = true
  }
}

function onMouseLeave() {
  if (isHeaderMode.value) {
    hideTimer = setTimeout(() => {
      isToolsPanelOpen.value = false
    }, 200)
    return
  }
  if (isToolsPanelLocked.value) return
  hideTimer = setTimeout(() => {
    isHovered.value = false
  }, 200)
}

watch(toolsPanelPosition, () => {
  isToolsPanelOpen.value = false
  isHovered.value = false
})

type ToolEvent =
  | 'openIncrementalImport'
  | 'openSessionIndex'
  | 'openMemberManagement'
  | 'openChatRecord'
  | 'openMessageExport'

const emit = defineEmits<{
  (e: ToolEvent): void
}>()

function handleToolClick(event: ToolEvent) {
  emit(event)
  if (isHeaderMode.value) {
    isToolsPanelOpen.value = false
  } else if (!isToolsPanelLocked.value) {
    isHovered.value = false
  }
}

const tools = [
  {
    event: 'openIncrementalImport' as const,
    icon: 'i-heroicons-plus-circle',
    hoverColor: 'group-hover:text-pink-500',
    miniHoverBg: 'hover:text-pink-500',
    labelKey: 'analysis.tooltip.incrementalImport',
  },
  {
    event: 'openSessionIndex' as const,
    icon: 'i-heroicons-clock',
    hoverColor: 'group-hover:text-blue-500',
    miniHoverBg: 'hover:text-blue-500',
    labelKey: 'analysis.tooltip.sessionIndex',
  },
  {
    event: 'openMemberManagement' as const,
    icon: 'i-heroicons-user-group',
    hoverColor: 'group-hover:text-purple-500',
    miniHoverBg: 'hover:text-purple-500',
    labelKey: 'analysis.tooltip.memberManagement',
  },
  {
    event: 'openChatRecord' as const,
    icon: 'i-heroicons-chat-bubble-bottom-center-text',
    hoverColor: 'group-hover:text-cyan-500',
    miniHoverBg: 'hover:text-cyan-500',
    labelKey: 'analysis.tooltip.viewChatRecord',
  },
  {
    event: 'openMessageExport' as const,
    icon: 'i-heroicons-document-arrow-down',
    hoverColor: 'group-hover:text-green-500',
    miniHoverBg: 'hover:text-green-500',
    labelKey: 'analysis.messageExport.title',
  },
]
</script>

<template>
  <!-- Mini 模式：常驻竖条，只有图标（仅 side 模式） -->
  <div v-if="!isHeaderMode && isToolsPanelMini" class="fixed right-0 top-1/3">
    <div
      class="no-capture flex flex-col items-center gap-0.5 rounded-l-lg border border-r-0 border-gray-200/60 bg-white py-1.5 shadow-sm dark:border-white/5 dark:bg-gray-900"
    >
      <UTooltip v-for="tool in tools" :key="tool.event" :text="t(tool.labelKey)" :popper="{ placement: 'left' }">
        <button
          class="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 dark:text-gray-500 dark:hover:bg-white/5"
          :class="tool.miniHoverBg"
          @click="handleToolClick(tool.event)"
        >
          <UIcon :name="tool.icon" class="h-3.5 w-3.5" />
        </button>
      </UTooltip>

      <!-- 分隔线 -->
      <div class="my-0.5 h-px w-4 bg-gray-200 dark:bg-gray-700" />

      <!-- 退出 mini 模式 -->
      <UTooltip :text="t('analysis.toolsPanel.exitMini')" :popper="{ placement: 'left' }">
        <button
          class="flex h-7 w-7 items-center justify-center rounded-md text-gray-300 transition-colors hover:bg-gray-100 hover:text-gray-500 dark:text-gray-600 dark:hover:bg-white/5 dark:hover:text-gray-400"
          @click="layoutStore.toggleToolsPanelMini()"
        >
          <UIcon name="i-heroicons-arrows-pointing-out" class="h-3 w-3" />
        </button>
      </UTooltip>
    </div>
  </div>

  <!-- 普通/header 模式：面板从右侧滑入 -->
  <div
    v-else
    class="fixed right-0 z-40"
    :class="isHeaderMode ? 'top-14' : 'top-1/3'"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <!-- Trigger 标签（仅 side 模式） -->
    <div
      v-if="!isHeaderMode"
      class="h-10 w-6 cursor-pointer items-center justify-center rounded-l-lg border border-r-0 border-primary-200 bg-primary-50 text-primary-500 shadow-sm transition-opacity duration-200 hover:bg-primary-100 hover:text-primary-600 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-400 dark:hover:bg-primary-900 dark:hover:text-primary-300"
      :class="isVisible ? 'pointer-events-none flex opacity-0' : 'flex opacity-100'"
    >
      <UIcon name="i-heroicons-wrench-screwdriver" class="h-3.5 w-3.5" />
    </div>

    <!-- 面板（从右侧滑入） -->
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
          <div v-if="!isHeaderMode" class="flex items-center gap-0.5">
            <!-- Mini 模式按钮 -->
            <UTooltip :text="t('analysis.toolsPanel.miniMode')" :popper="{ placement: 'left' }">
              <button
                class="flex h-5 w-5 items-center justify-center rounded text-gray-300 transition-colors hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400"
                @click="layoutStore.toggleToolsPanelMini()"
              >
                <UIcon name="i-heroicons-arrows-pointing-in" class="h-3 w-3" />
              </button>
            </UTooltip>
            <!-- 锁定按钮 -->
            <UTooltip
              :text="isToolsPanelLocked ? t('analysis.toolsPanel.unlock') : t('analysis.toolsPanel.lock')"
              :popper="{ placement: 'left' }"
            >
              <button
                class="flex h-5 w-5 items-center justify-center rounded transition-colors"
                :class="
                  isToolsPanelLocked
                    ? 'text-pink-500 hover:text-pink-600 dark:text-pink-400'
                    : 'text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400'
                "
                @click="layoutStore.toggleToolsPanelLock()"
              >
                <UIcon
                  :name="isToolsPanelLocked ? 'i-heroicons-lock-closed-solid' : 'i-heroicons-lock-open'"
                  class="h-3 w-3"
                />
              </button>
            </UTooltip>
          </div>
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
