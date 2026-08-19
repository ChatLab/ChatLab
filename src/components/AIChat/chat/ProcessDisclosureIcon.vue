<script setup lang="ts">
withDefaults(
  defineProps<{
    icon: string
    open: boolean
    iconClass?: string
  }>(),
  {
    iconClass: 'text-gray-400 dark:text-gray-500',
  }
)
</script>

<template>
  <span class="relative flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
    <UIcon
      v-if="!open"
      :name="icon"
      class="absolute h-3.5 w-3.5 transition-opacity duration-100 group-hover/process-toggle:opacity-0"
      :class="iconClass"
    />
    <UIcon
      name="i-heroicons-chevron-down"
      class="absolute h-3.5 w-3.5 text-gray-500 transition-opacity duration-100 dark:text-gray-400"
      :class="open ? 'opacity-100' : 'opacity-0 group-hover/process-toggle:opacity-100'"
    />
  </span>
</template>
