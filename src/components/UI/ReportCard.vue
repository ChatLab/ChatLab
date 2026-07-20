<script setup lang="ts">
import CardCaptureOverlay from './CardCaptureOverlay.vue'
import CardDecoration from './CardDecoration.vue'
import ThemeCard from './ThemeCard.vue'

withDefaults(
  defineProps<{
    /** 是否显示截图入口 */
    capturable?: boolean
  }>(),
  {
    capturable: true,
  }
)
</script>

<template>
  <ThemeCard data-capturable-card class="group/card relative isolate flex flex-col">
    <CardDecoration />
    <CardCaptureOverlay v-if="capturable" />
    <slot />
  </ThemeCard>
</template>
