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
      class="transition-all duration-200 rounded-xl hover:bg-gray-200/40 dark:hover:bg-gray-800/40 h-10 cursor-pointer"
      :class="[
        isCollapsed ? 'flex w-10 items-center justify-center px-0 mx-auto' : 'justify-start pl-1.5',
        active
          ? 'bg-gray-200/50 dark:bg-gray-800/80 text-gray-900 dark:text-white font-medium'
          : 'text-gray-600 dark:text-gray-300',
      ]"
      color="gray"
      variant="ghost"
    >
      <UIcon :name="icon" class="h-5 w-5 shrink-0" :class="[isCollapsed ? '' : 'mr-2.5']" />
      <span v-if="!isCollapsed" class="truncate text-xs font-medium">{{ title }}</span>
    </UButton>
  </UTooltip>
</template>
