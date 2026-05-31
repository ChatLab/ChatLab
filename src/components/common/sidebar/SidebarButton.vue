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
    <!-- 收起状态：用原生 div 承载背景和尺寸，与会话列表项结构一致，避免 UButton 内部撑大 -->
    <div
      v-if="isCollapsed"
      class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl mx-auto transition-all duration-200"
      :class="[
        active
          ? 'bg-gray-200/50 dark:bg-gray-800/80 text-gray-900 dark:text-white'
          : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200/40 dark:hover:bg-gray-800/40',
      ]"
    >
      <UIcon :name="icon" class="h-5 w-5 shrink-0" />
    </div>
    <!-- 展开状态：保持原有 UButton 样式 -->
    <UButton
      v-else
      class="transition-all duration-200 rounded-xl hover:bg-gray-200/40 dark:hover:bg-gray-800/40 h-10 cursor-pointer justify-start pl-1.5 w-[calc(100%-8px)]"
      :class="[
        active
          ? 'bg-gray-200/50 dark:bg-gray-800/80 text-gray-900 dark:text-white font-medium'
          : 'text-gray-600 dark:text-gray-300',
      ]"
      color="gray"
      variant="ghost"
    >
      <UIcon :name="icon" class="mr-2.5 h-5 w-5 shrink-0" />
      <span class="truncate text-xs font-medium">{{ title }}</span>
    </UButton>
  </UTooltip>
</template>
