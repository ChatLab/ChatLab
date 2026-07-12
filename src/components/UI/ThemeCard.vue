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
  <div class="overflow-hidden rounded-2xl bg-card-bg dark:bg-card-dark" :class="{ 'shadow-elevated': shadow }">
    <slot />
  </div>
</template>
