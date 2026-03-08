<script setup lang="ts">
import { ref, onMounted } from 'vue'

// Detect platform for styling (e.g. macOS top-bar safe area)
const isMac = ref(false)

onMounted(() => {
  isMac.value = navigator.platform.toLowerCase().includes('mac')
})
</script>

<template>
  <div class="title-bar">
    <!-- Left spacer for macOS top bar safe area -->
    <div v-if="isMac" class="traffic-light-spacer" />

    <!-- Drag region fills remaining space -->
    <div class="drag-region" />
  </div>
</template>

<style scoped>
.title-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 32px;
  display: flex;
  align-items: center;
  z-index: 9999;
}

/* macOS top-bar safe area */
.traffic-light-spacer {
  width: 70px;
  height: 100%;
  flex-shrink: 0;
}

/* Drag region fills remaining space */
.drag-region {
  flex: 1;
  height: 100%;
}
</style>
