<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useLayoutStore } from '@/stores/layout'

interface Props {
  icon: string
  title: string
  active?: boolean
  tooltip?: string
  iconClass?: string
}

withDefaults(defineProps<Props>(), {
  active: false,
  tooltip: '',
  iconClass: '',
})

const layoutStore = useLayoutStore()
const { isSidebarCollapsed: isCollapsed } = storeToRefs(layoutStore)
</script>

<template>
  <!-- 收起状态：UTooltip 只包收起态 div，避免 as-child 在 v-if/v-else 切换时引用错乱 -->
  <UTooltip v-if="isCollapsed" :text="tooltip || title" :content="{ side: 'right' }">
    <div
      class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl mx-auto transition-all duration-200"
      :class="[
        active
          ? 'bg-gray-200/50 dark:bg-gray-800/80 text-gray-900 dark:text-white'
          : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200/40 dark:hover:bg-gray-800/40',
      ]"
    >
      <UIcon :name="icon" class="h-5 w-5 shrink-0" :class="iconClass" />
    </div>
  </UTooltip>
  <!-- 展开状态：直接渲染 UButton，标题已可见，无需 tooltip -->
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
    <UIcon :name="icon" class="mr-2.5 h-5 w-5 shrink-0" :class="iconClass" />
    <span class="truncate text-xs font-medium">{{ title }}</span>
  </UButton>
</template>
