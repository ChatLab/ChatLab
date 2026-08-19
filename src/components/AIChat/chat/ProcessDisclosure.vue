<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{
    lazy?: boolean
  }>(),
  {
    lazy: false,
  }
)

const open = ref(false)
const hasOpened = ref(false)

function toggle() {
  if (!open.value) hasOpened.value = true
  open.value = !open.value
}
</script>

<template>
  <div>
    <slot name="summary" :open="open" :toggle="toggle" />
    <div class="ai-process-fold" :data-open="open || undefined" :aria-hidden="!open" :inert="open ? undefined : true">
      <div class="ai-process-fold-inner">
        <slot v-if="!props.lazy || hasOpened" />
      </div>
    </div>
  </div>
</template>
