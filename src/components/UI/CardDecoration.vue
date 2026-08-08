<script setup lang="ts">
import { computed } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { getInsightCardTheme } from '@/utils/insight-card-theme'
import type { InsightCardThemeId } from '@/utils/insight-card-theme'

const props = defineProps<{
  theme?: InsightCardThemeId
}>()

const settingsStore = useSettingsStore()
const isVivid = computed(() => props.theme !== undefined)

const decorationStyle = computed(() => {
  const theme = getInsightCardTheme(props.theme ?? settingsStore.insightCardTheme)

  return {
    '--insight-card-glow-start': theme.startColor,
    '--insight-card-glow-end': theme.endColor,
  }
})
</script>

<template>
  <div
    class="pointer-events-none absolute inset-0 overflow-hidden"
    :class="{ 'card-decoration--vivid': isVivid }"
    :style="decorationStyle"
  >
    <div
      class="insight-card-glow-start absolute rounded-full"
      :class="
        isVivid
          ? '-left-[15%] -top-[15%] h-[60%] w-[60%] blur-[60px]'
          : '-left-[20%] -top-[20%] h-[70%] w-[70%] blur-[80px]'
      "
    />
    <div
      class="insight-card-glow-end absolute rounded-full"
      :class="
        isVivid
          ? '-right-[15%] top-[5%] h-[60%] w-[60%] blur-[60px]'
          : '-right-[20%] top-[10%] h-[70%] w-[70%] blur-[80px]'
      "
    />
    <div
      v-if="isVivid"
      class="insight-card-glow-center absolute bottom-0 left-1/3 h-[30%] w-[30%] rounded-full blur-[40px]"
    />
  </div>
</template>

<style scoped>
.insight-card-glow-start {
  background-color: color-mix(in srgb, var(--insight-card-glow-start) 10%, transparent);
}

.insight-card-glow-end {
  background-color: color-mix(in srgb, var(--insight-card-glow-end) 10%, transparent);
}

.card-decoration--vivid .insight-card-glow-start {
  background-color: color-mix(in srgb, var(--insight-card-glow-start) 25%, transparent);
}

.card-decoration--vivid .insight-card-glow-end {
  background-color: color-mix(in srgb, var(--insight-card-glow-end) 25%, transparent);
}

.insight-card-glow-center {
  background-color: color-mix(in srgb, var(--insight-card-glow-start) 15%, var(--insight-card-glow-end) 15%);
}

:global(.dark .insight-card-glow-start) {
  background-color: color-mix(in srgb, var(--insight-card-glow-start) 20%, transparent);
}

:global(.dark .insight-card-glow-end) {
  background-color: color-mix(in srgb, var(--insight-card-glow-end) 20%, transparent);
}

:global(.dark .card-decoration--vivid .insight-card-glow-start) {
  background-color: color-mix(in srgb, var(--insight-card-glow-start) 40%, transparent);
}

:global(.dark .card-decoration--vivid .insight-card-glow-end) {
  background-color: color-mix(in srgb, var(--insight-card-glow-end) 40%, transparent);
}

:global(.dark .card-decoration--vivid .insight-card-glow-center) {
  background-color: color-mix(in srgb, var(--insight-card-glow-start) 25%, var(--insight-card-glow-end) 25%);
}
</style>
