<script setup lang="ts">
import { RouterLink, type RouteLocationRaw } from 'vue-router'

interface PageNavItem {
  id: string
  label: string
  icon?: string
  to?: RouteLocationRaw
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    items: PageNavItem[]
    ariaLabel?: string
  }>(),
  {
    ariaLabel: undefined,
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
}>()

function selectItem(item: PageNavItem): void {
  if (item.to || item.id === props.modelValue) return
  emit('update:modelValue', item.id)
  emit('change', item.id)
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
    <nav class="min-w-0 overflow-x-auto scrollbar-hide" :aria-label="ariaLabel">
      <div class="flex w-max items-center gap-0.5">
        <component
          :is="item.to ? RouterLink : 'button'"
          v-for="item in items"
          :key="item.id"
          :to="item.to"
          :type="item.to ? undefined : 'button'"
          class="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors"
          :class="
            modelValue === item.id
              ? 'bg-primary-500 text-white dark:bg-primary-900/30 dark:text-primary-300'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
          "
          :aria-pressed="item.to ? undefined : modelValue === item.id"
          @click="selectItem(item)"
        >
          <UIcon v-if="item.icon" :name="item.icon" class="h-3.5 w-3.5" />
          <span>{{ item.label }}</span>
        </component>
      </div>
    </nav>

    <div v-if="$slots.right" class="flex w-full min-w-0 shrink-0 flex-wrap items-center xl:w-auto xl:justify-end">
      <slot name="right" />
    </div>
  </div>
</template>
