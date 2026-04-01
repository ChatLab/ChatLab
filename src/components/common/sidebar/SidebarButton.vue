<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useLayoutStore } from '@/stores/layout'

interface Props {
  icon: string
  title: string
  active?: boolean
  tooltip?: string
}

withDefaults(defineProps<Props>(), {
  active: false,
  tooltip: '',
})

const layoutStore = useLayoutStore()
const { isSidebarCollapsed: isCollapsed } = storeToRefs(layoutStore)
</script>

<template>
  <UTooltip :text="isCollapsed ? tooltip || title : ''" :popper="{ placement: 'right' }">
    <UButton
      :block="!isCollapsed"
      class="transition-all rounded-full hover:bg-gray-200/60 dark:hover:bg-gray-800 h-12 cursor-pointer"
      :class="[
        isCollapsed ? 'flex w-12 items-center justify-center px-0' : 'justify-start pl-4',
        active ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400' : '',
      ]"
      color="gray"
      variant="ghost"
    >
      <UIcon :name="icon" class="h-5 w-5 shrink-0" :class="[isCollapsed ? '' : 'mr-2']" />
      <span v-if="!isCollapsed" class="truncate">{{ title }}</span>
    </UButton>
  </UTooltip>
</template>
