<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useLayoutStore } from '@/stores/layout'

const props = withDefaults(
  defineProps<{ sessionId?: string | null; contextKey?: string | null; defaultView?: 'records' | 'topics' }>(),
  { defaultView: 'records' }
)
const ChatRecordWorkspace = defineAsyncComponent(() => import('@/components/common/ChatRecord/ChatRecordWorkspace.vue'))
const layout = useLayoutStore()
const route = useRoute()
const { t } = useI18n()
const root = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const containerWidth = ref(1200)
const resizing = ref(false)
const records = computed(() => layout.sidePanelView === 'records')
const topics = computed(() => layout.sidePanelView === 'topics')
const title = computed(() =>
  t(records.value ? 'records.drawer.title' : topics.value ? 'records.topics.title' : 'contacts.detail.title')
)
const preferredWidth = computed({
  get: () =>
    records.value ? layout.chatRecordDrawerWidth : topics.value ? layout.topicsPanelWidth : layout.contactPanelWidth,
  set: (value) => {
    if (records.value) layout.chatRecordDrawerWidth = value
    else if (topics.value) layout.topicsPanelWidth = value
    else layout.contactPanelWidth = value
  },
})
const minimumWidth = computed(() => (records.value ? 480 : topics.value ? 288 : 360))
// Measure the available page area, not the window: the main navigation also takes space.
const overlay = computed(() => containerWidth.value < minimumWidth.value + 520)
const maximumWidth = computed(() => Math.max(0, containerWidth.value - (overlay.value ? 16 : 520)))
const width = computed(() => Math.min(maximumWidth.value, Math.max(minimumWidth.value, preferredWidth.value)))
let previousFocus: HTMLElement | null = null
let dragStartX = 0
let dragStartWidth = 0
let resizeHandle: HTMLElement | null = null
let resizePointerId: number | null = null

useResizeObserver(root, ([entry]) => {
  if (entry) containerWidth.value = entry.contentRect.width
})

watch(
  [() => route.path, () => props.sessionId, () => props.contextKey, () => props.defaultView],
  () => layout.setSidePanelContext(props.sessionId ?? null, props.defaultView),
  { immediate: true, flush: 'sync' }
)

watch(
  [() => layout.sidePanelOpen, overlay],
  async ([open, isOverlay], [wasOpen]) => {
    if (open) {
      if (!wasOpen) previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
      if (isOverlay) {
        await nextTick()
        if (layout.sidePanelOpen) panel.value?.focus({ preventScroll: true })
      }
    } else {
      stopResize()
      if (panel.value?.contains(document.activeElement)) {
        const toggle = document.querySelector<HTMLElement>('[data-side-panel-toggle]')
        ;(toggle || previousFocus)?.focus({ preventScroll: true })
      }
    }
  },
  { flush: 'pre' }
)

function clampWidth(value: number) {
  return Math.min(maximumWidth.value, Math.max(minimumWidth.value, value))
}

function stopResize(event?: Event) {
  if (event instanceof PointerEvent && event.pointerId !== resizePointerId) return
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
  if (resizing.value) {
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
  resizing.value = false
}

function handleResize(event: PointerEvent) {
  if (event.pointerId !== resizePointerId) return
  preferredWidth.value = clampWidth(dragStartWidth + dragStartX - event.clientX)
}

function startResize(event: PointerEvent) {
  if (event.button !== 0 || resizePointerId !== null) return
  resizeHandle = event.currentTarget as HTMLElement
  resizePointerId = event.pointerId
  resizeHandle.setPointerCapture(resizePointerId)
  resizeHandle.addEventListener('lostpointercapture', stopResize)
  dragStartX = event.clientX
  dragStartWidth = width.value
  resizing.value = true
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
  preferredWidth.value = clampWidth(width.value + (event.key === 'ArrowLeft' ? 24 : -24))
}

onBeforeUnmount(() => {
  stopResize()
  layout.setSidePanelContext(null)
})
</script>

<template>
  <div ref="root" class="side-panel-layout relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
    <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" :inert="overlay && layout.sidePanelOpen">
      <slot />
    </div>

    <Transition name="side-panel-backdrop">
      <div
        v-if="overlay && layout.sidePanelOpen"
        class="absolute inset-0 z-40 bg-black/15 dark:bg-black/35"
        aria-hidden="true"
        @click="layout.closeSidePanel()"
      />
    </Transition>

    <aside
      id="app-side-panel"
      ref="panel"
      tabindex="-1"
      :aria-label="title"
      :aria-hidden="!layout.sidePanelOpen"
      :inert="!layout.sidePanelOpen"
      class="side-panel relative z-[41] h-full shrink-0 overflow-hidden outline-none"
      :class="{ 'side-panel-overlay': overlay, 'side-panel-resizing': resizing }"
      :style="{ width: layout.sidePanelOpen ? `${width}px` : '0px' }"
      @keydown.esc.stop="layout.closeSidePanel()"
    >
      <!-- Keep the inner width stable while the outer shell collapses. -->
      <div class="h-full" :style="{ width: `${width}px` }">
        <div
          class="relative flex h-full min-h-0 flex-col border-l border-gray-200 bg-white dark:border-white/5 dark:bg-page-dark"
        >
          <div
            class="group absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize touch-none"
            role="separator"
            aria-orientation="vertical"
            :aria-label="t('common.sidePanel.resize')"
            :aria-valuemin="Math.min(minimumWidth, maximumWidth)"
            :aria-valuemax="maximumWidth"
            :aria-valuenow="width"
            tabindex="0"
            @pointerdown.prevent="startResize"
            @keydown="resizeWithKeyboard"
          >
            <div class="h-full w-px transition-colors group-hover:bg-primary-400 group-focus:bg-primary-500" />
          </div>

          <header class="flex h-12 shrink-0 items-center gap-2 border-b border-gray-100 px-3 dark:border-white/5">
            <UButton
              v-if="layout.canReturnSidePanel"
              icon="i-lucide-arrow-left"
              color="neutral"
              variant="ghost"
              size="sm"
              :aria-label="t('common.back')"
              @click="layout.returnToSidePanel()"
            />
            <h2 class="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 dark:text-gray-100">{{ title }}</h2>
            <div v-show="topics" id="side-panel-topic-actions" class="flex shrink-0 items-center gap-0.5" />
            <UButton
              icon="i-lucide-panel-right-close"
              color="neutral"
              variant="ghost"
              size="sm"
              :aria-label="t('common.sidePanel.collapse')"
              @click="layout.closeSidePanel()"
            />
          </header>

          <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
            <!-- Topics keep their message navigation handlers in the owning workspace. -->
            <div v-show="topics" id="side-panel-topics" class="flex min-h-0 flex-1 flex-col overflow-hidden" />
            <ChatRecordWorkspace
              v-if="layout.chatRecordQuery"
              v-show="records"
              :initial-query="layout.chatRecordQuery"
              class="min-h-0 flex-1"
              mode="drawer"
            />
            <div
              v-if="layout.sidePanelHasContact"
              v-show="layout.sidePanelView === 'contact'"
              class="flex min-h-0 flex-1 flex-col overflow-hidden"
            >
              <slot name="contact" />
            </div>
          </div>
        </div>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.side-panel {
  transition: width 240ms cubic-bezier(0.22, 1, 0.36, 1);
  -webkit-app-region: no-drag;
}

.side-panel-overlay {
  position: absolute;
  right: 0;
  top: 0;
}

.side-panel-resizing {
  transition: none;
}

.side-panel-backdrop-enter-active,
.side-panel-backdrop-leave-active {
  transition: opacity 200ms ease;
}

.side-panel-backdrop-enter-from,
.side-panel-backdrop-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .side-panel,
  .side-panel-backdrop-enter-active,
  .side-panel-backdrop-leave-active {
    transition: none;
  }
}
</style>
