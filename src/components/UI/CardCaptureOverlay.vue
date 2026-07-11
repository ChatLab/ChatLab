<script setup lang="ts">
import CaptureButton from '@/components/common/CaptureButton.vue'
</script>

<template>
  <div
    class="pointer-events-none absolute right-3 top-3 z-50 opacity-0 transition-opacity duration-200 group-hover/card:pointer-events-auto group-hover/card:opacity-100"
  >
    <CaptureButton type="element" target-selector="[data-capturable-card]" size="xs" />
  </div>
</template>
