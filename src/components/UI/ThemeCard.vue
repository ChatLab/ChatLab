<script setup lang="ts">
withDefaults(
  defineProps<{
    shadow?: boolean
  }>(),
  {
    shadow: true,
  }
)
</script>

<template>
  <div
    class="overflow-hidden rounded-2xl border border-gray-200/60 bg-card-bg transition-shadow duration-300 hover:shadow-lg motion-reduce:transition-none dark:border-white/5 dark:bg-card-dark"
    :class="{ 'shadow-elevated': shadow }"
  >
    <slot />
  </div>
</template>
