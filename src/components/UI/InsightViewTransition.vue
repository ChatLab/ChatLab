<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, provide, ref, watch } from 'vue'
import type { Ref } from 'vue'
import InsightLoadingDots from './InsightLoadingDots.vue'
import { insightViewLoadingCoordinatorKey } from './insight-view-loading'

type PaneId = 'primary' | 'secondary'
type TransitionPhase = 'idle' | 'waiting' | 'revealing'

const props = defineProps<{
  activeKey: string
}>()

defineSlots<{
  default(props: { viewKey: string }): unknown
}>()

const primaryKey = ref<string | null>(props.activeKey)
const secondaryKey = ref<string | null>(null)
const activePane = ref<PaneId>('primary')
const phase = ref<TransitionPhase>('idle')
const pendingLoaders = ref(0)
const sessionSwitchLoading = inject<Ref<boolean> | null>('session-switch-loading', null)

const displayedKey = computed(() => (activePane.value === 'primary' ? primaryKey.value : secondaryKey.value))
const pendingPane = computed<PaneId>(() => (activePane.value === 'primary' ? 'secondary' : 'primary'))
const isTransitioning = computed(() => phase.value !== 'idle')
const showIndicator = computed(() => phase.value === 'waiting' && !sessionSwitchLoading?.value)

provide(insightViewLoadingCoordinatorKey, {
  register: registerPageLoader,
  suppress: isTransitioning,
})

let transitionVersion = 0
let revealTimer: ReturnType<typeof setTimeout> | null = null

function clearRevealTimer() {
  if (revealTimer) clearTimeout(revealTimer)
  revealTimer = null
}

function registerPageLoader() {
  const version = transitionVersion
  let registered = true
  pendingLoaders.value++

  return () => {
    if (!registered) return
    registered = false
    // 旧面板或上一次快速切换留下的 Loading，不得阻塞当前目标视图。
    if (version !== transitionVersion) return
    pendingLoaders.value = Math.max(0, pendingLoaders.value - 1)
  }
}

function setPaneKey(pane: PaneId, key: string | null) {
  if (pane === 'primary') primaryKey.value = key
  else secondaryKey.value = key
}

function paneClass(pane: PaneId) {
  const isActive = pane === activePane.value
  return {
    'insight-view-transition__pane--active': isActive && phase.value === 'idle',
    'insight-view-transition__pane--waiting': isActive && phase.value === 'waiting',
    'insight-view-transition__pane--outgoing': isActive && phase.value === 'revealing',
    'insight-view-transition__pane--pending': !isActive && phase.value === 'waiting',
    'insight-view-transition__pane--incoming': !isActive && phase.value === 'revealing',
  }
}

async function revealWhenReady(version: number) {
  // LoadingState 在子组件 mounted 时登记；等待两轮渲染，避免把尚未登记的视图误判为同步完成。
  await nextTick()
  await nextTick()
  if (version !== transitionVersion || phase.value !== 'waiting' || pendingLoaders.value > 0) return

  phase.value = 'revealing'
  revealTimer = setTimeout(() => {
    if (version !== transitionVersion) return
    const previousPane = activePane.value
    activePane.value = pendingPane.value
    setPaneKey(previousPane, null)
    phase.value = 'idle'
    revealTimer = null
  }, 180)
}

function beginTransition(nextKey: string) {
  const version = ++transitionVersion
  clearRevealTimer()
  pendingLoaders.value = 0

  if (nextKey === displayedKey.value) {
    setPaneKey(pendingPane.value, null)
    phase.value = 'idle'
    return
  }

  setPaneKey(pendingPane.value, nextKey)
  phase.value = 'waiting'
  void revealWhenReady(version)
}

watch(
  () => props.activeKey,
  (nextKey) => beginTransition(nextKey)
)

watch(pendingLoaders, (count) => {
  if (count === 0 && phase.value === 'waiting') void revealWhenReady(transitionVersion)
})

onBeforeUnmount(() => {
  transitionVersion++
  clearRevealTimer()
})
</script>

<template>
  <div class="insight-view-transition" :aria-busy="isTransitioning">
    <div v-if="showIndicator" class="insight-view-transition__indicator" aria-hidden="true">
      <InsightLoadingDots />
    </div>

    <div
      v-if="primaryKey"
      class="insight-view-transition__pane"
      :class="paneClass('primary')"
      :inert="activePane !== 'primary' || isTransitioning"
      :aria-hidden="activePane !== 'primary'"
    >
      <slot :view-key="primaryKey" />
    </div>

    <div
      v-if="secondaryKey"
      class="insight-view-transition__pane"
      :class="paneClass('secondary')"
      :inert="activePane !== 'secondary' || isTransitioning"
      :aria-hidden="activePane !== 'secondary'"
    >
      <slot :view-key="secondaryKey" />
    </div>
  </div>
</template>

<style scoped>
.insight-view-transition {
  position: relative;
  min-height: 100%;
}

.insight-view-transition__indicator {
  position: sticky;
  z-index: 3;
  top: calc(50% - 0.4375rem);
  display: flex;
  height: 0;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.insight-view-transition__pane {
  width: 100%;
  transition:
    opacity 180ms ease,
    filter 180ms ease;
}

.insight-view-transition__pane--active {
  position: relative;
  opacity: 1;
  filter: none;
}

.insight-view-transition__pane--waiting {
  position: relative;
  opacity: 0.52;
  filter: blur(1.5px);
  pointer-events: none;
  user-select: none;
}

.insight-view-transition__pane--pending,
.insight-view-transition__pane--incoming {
  position: absolute;
  z-index: 1;
  inset: 0;
  pointer-events: none;
}

.insight-view-transition__pane--pending {
  opacity: 0;
}

.insight-view-transition__pane--outgoing {
  position: relative;
  opacity: 0;
  filter: blur(2px);
  pointer-events: none;
}

.insight-view-transition__pane--incoming {
  opacity: 1;
  filter: none;
}

@media (prefers-reduced-motion: reduce) {
  .insight-view-transition__pane {
    transition: none;
  }

  .insight-view-transition__pane--waiting,
  .insight-view-transition__pane--outgoing {
    filter: none;
  }
}
</style>
