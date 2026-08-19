<script setup lang="ts">
import { ref } from 'vue'

const open = ref(false)

function toggle() {
  open.value = !open.value
}
</script>

<template>
  <div>
    <slot name="summary" :open="open" :toggle="toggle" />
    <div class="ai-process-fold" :data-open="open || undefined" :aria-hidden="!open" :inert="open ? undefined : true">
      <div class="ai-process-fold-inner">
        <slot />
      </div>
    </div>
  </div>
</template>
