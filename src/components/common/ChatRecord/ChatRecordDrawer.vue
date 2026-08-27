<script setup lang="ts">
/**
 * Chat record viewer drawer.
 * Keeps the quick-view shell while ChatRecordWorkspace owns shared orchestration.
 */
import { computed, onBeforeUnmount, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import ChatRecordWorkspace from './ChatRecordWorkspace.vue'
import { useLayoutStore } from '@/stores/layout'

const { t } = useI18n()
const layoutStore = useLayoutStore()

// 平台检测
const isWindows = ref(false)
const MIN_DRAWER_WIDTH = 480
const VIEWPORT_MARGIN = 32
let dragStartX = 0
let dragStartWidth = 0
let resizeHandle: HTMLElement | null = null
let resizePointerId: number | null = null

const maxDrawerWidth = ref(1280 - VIEWPORT_MARGIN)
const minDrawerWidth = computed(() => Math.min(MIN_DRAWER_WIDTH, maxDrawerWidth.value))
const effectiveDrawerWidth = computed(() => clampDrawerWidth(layoutStore.chatRecordDrawerWidth))

function updateViewportLimit() {
  maxDrawerWidth.value = Math.max(0, window.innerWidth - VIEWPORT_MARGIN)
}

function clampDrawerWidth(width: number) {
  return Math.min(maxDrawerWidth.value, Math.max(minDrawerWidth.value, width))
}

function stopResize() {
  window.removeEventListener('pointermove', handleResize)
  window.removeEventListener('pointerup', stopResize)
  window.removeEventListener('pointercancel', stopResize)
  window.removeEventListener('blur', stopResize)
  resizeHandle?.removeEventListener('lostpointercapture', stopResize)
  if (resizeHandle && resizePointerId !== null && resizeHandle.hasPointerCapture(resizePointerId)) {
    resizeHandle.releasePointerCapture(resizePointerId)
  }
  resizeHandle = null
  resizePointerId = null
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

function handleResize(event: PointerEvent) {
  layoutStore.chatRecordDrawerWidth = clampDrawerWidth(dragStartWidth + dragStartX - event.clientX)
}

function startResize(event: PointerEvent) {
  if (event.button !== 0) return
  resizeHandle = event.currentTarget as HTMLElement
  resizePointerId = event.pointerId
  resizeHandle.setPointerCapture(resizePointerId)
  resizeHandle.addEventListener('lostpointercapture', stopResize)
  dragStartX = event.clientX
  dragStartWidth = effectiveDrawerWidth.value
  window.addEventListener('pointermove', handleResize)
  window.addEventListener('pointerup', stopResize)
  window.addEventListener('pointercancel', stopResize)
  window.addEventListener('blur', stopResize)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function resizeWithKeyboard(event: KeyboardEvent) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  const delta = event.key === 'ArrowLeft' ? 24 : -24
  layoutStore.chatRecordDrawerWidth = clampDrawerWidth(effectiveDrawerWidth.value + delta)
}

onMounted(() => {
  isWindows.value = navigator.platform.toLowerCase().includes('win')
  updateViewportLimit()
  window.addEventListener('resize', updateViewportLimit)
})

onBeforeUnmount(() => {
  stopResize()
  window.removeEventListener('resize', updateViewportLimit)
})
</script>

<template>
  <UDrawer
    v-model:open="layoutStore.showChatRecordDrawer"
    direction="right"
    :handle="false"
    handle-only
    :ui="{ content: 'z-50' }"
  >
    <template #content>
      <div
        data-vaul-no-drag
        class="chat-record-drawer-content relative flex h-full flex-col bg-white dark:bg-page-dark"
        :style="{ width: `${effectiveDrawerWidth}px`, maxWidth: `calc(100vw - ${VIEWPORT_MARGIN}px)` }"
        style="-webkit-app-region: no-drag"
      >
        <div
          class="group absolute inset-y-0 left-0 z-10 w-2 -translate-x-1/2 cursor-col-resize touch-none"
          role="separator"
          aria-orientation="vertical"
          :aria-label="t('records.drawer.resize')"
          :aria-valuemin="minDrawerWidth"
          :aria-valuemax="maxDrawerWidth"
          :aria-valuenow="effectiveDrawerWidth"
          tabindex="0"
          @pointerdown.prevent="startResize"
          @keydown="resizeWithKeyboard"
        >
          <div
            class="mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-primary-400 group-focus:bg-primary-500"
          />
        </div>
        <!-- 头部 -->
        <div
          class="flex items-center justify-between border-b border-gray-200 px-4 dark:border-gray-800"
          :class="isWindows ? 'pt-10 pb-3' : 'py-3'"
        >
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('records.drawer.title') }}</h3>
          <UButton
            icon="i-heroicons-x-mark"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="layoutStore.closeChatRecordDrawer()"
          />
        </div>

        <ChatRecordWorkspace
          class="min-h-0 flex-1"
          :initial-query="layoutStore.chatRecordQuery"
          :active="layoutStore.showChatRecordDrawer"
          mode="drawer"
        />
      </div>
    </template>
  </UDrawer>
</template>
