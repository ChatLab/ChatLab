<script setup lang="ts">
defineProps<{
  collapsed?: boolean
  accessibleLabel: string
}>()

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()
</script>

<template>
  <UButton
    v-if="!collapsed"
    color="neutral"
    variant="ghost"
    size="sm"
    square
    :aria-label="accessibleLabel"
    :aria-expanded="true"
    :title="accessibleLabel"
    class="group flex h-9 w-9 cursor-pointer items-center justify-center rounded-full hover:bg-gray-200/60 dark:hover:bg-white/[0.06]"
    style="-webkit-app-region: no-drag"
    @click="emit('click', $event)"
  >
    <template #leading>
      <UIcon name="i-lucide-panel-right" class="size-4 scale-x-[-1] group-hover:hidden" />
      <UIcon name="i-lucide-panel-right-close" class="size-4 hidden scale-x-[-1] group-hover:block" />
    </template>
  </UButton>
  <UButton
    v-else
    color="neutral"
    variant="ghost"
    size="sm"
    square
    :aria-label="accessibleLabel"
    :aria-expanded="false"
    :title="accessibleLabel"
    class="group relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-full hover:bg-gray-200/60 dark:hover:bg-white/[0.06]"
    style="-webkit-app-region: no-drag"
    @click="emit('click', $event)"
  >
    <template #leading>
      <slot>
        <UIcon name="i-lucide-panel-right-open" class="size-4 scale-x-[-1]" />
      </slot>
    </template>
  </UButton>
</template>
