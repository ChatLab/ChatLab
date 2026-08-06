<script setup lang="ts">
import { computed } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { getInsightCardTheme } from '@/utils/insight-card-theme'

const settingsStore = useSettingsStore()

const decorationStyle = computed(() => {
  const theme = getInsightCardTheme(settingsStore.insightCardTheme)

  return {
    '--insight-card-glow-start': theme.startColor,
    '--insight-card-glow-end': theme.endColor,
  }
})
</script>

<template>
  <div class="pointer-events-none absolute inset-0 overflow-hidden" :style="decorationStyle">
    <div class="insight-card-glow-start absolute -left-[20%] -top-[20%] h-[70%] w-[70%] rounded-full blur-[80px]" />
    <div class="insight-card-glow-end absolute -right-[20%] top-[10%] h-[70%] w-[70%] rounded-full blur-[80px]" />
  </div>
</template>

<style scoped>
.insight-card-glow-start {
  background-color: color-mix(in srgb, var(--insight-card-glow-start) 10%, transparent);
}

.insight-card-glow-end {
  background-color: color-mix(in srgb, var(--insight-card-glow-end) 10%, transparent);
}

:global(.dark) .insight-card-glow-start {
  background-color: color-mix(in srgb, var(--insight-card-glow-start) 20%, transparent);
}

:global(.dark) .insight-card-glow-end {
  background-color: color-mix(in srgb, var(--insight-card-glow-end) 20%, transparent);
}
</style>
