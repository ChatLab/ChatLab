<script setup lang="ts">
import CardCaptureOverlay from './CardCaptureOverlay.vue'
import CardDecoration from './CardDecoration.vue'
import ThemeCard from './ThemeCard.vue'
</script>

<template>
  <ThemeCard data-capturable-card class="group/card relative isolate flex flex-col">
    <CardDecoration />
    <CardCaptureOverlay />
    <slot />
  </ThemeCard>
</template>
