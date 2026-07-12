<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useLayoutStore } from '@/stores/layout'

interface Props {
  icon: string
  title: string
  active?: boolean
  tooltip?: string | false
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
  <UTooltip
    v-if="isCollapsed"
    :text="tooltip === false ? '' : tooltip || title"
    :disabled="tooltip === false"
    :content="{ side: 'right' }"
  >
    <div
      class="relative mx-auto flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg transition-all duration-200"
      :class="[
        active
          ? 'text-primary-600 dark:text-primary-400'
          : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200/40 dark:hover:bg-white/[0.06]',
      ]"
    >
      <span
        v-if="active"
        class="absolute -left-2 top-1/2 h-4.5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary-500"
      />
      <UIcon :name="icon" class="h-5 w-5 shrink-0" :class="iconClass" />
    </div>
  </UTooltip>
  <!-- 展开状态：直接渲染 UButton，标题已可见，无需 tooltip -->
  <UButton
    v-else
    class="relative h-10 w-[calc(100%-8px)] cursor-pointer justify-start rounded-xl pl-2.5 transition-all duration-200 hover:bg-gray-200/40 dark:hover:bg-white/[0.06]"
    :class="[
      active
        ? 'text-primary-600 font-medium dark:text-primary-400'
        : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white',
    ]"
    color="neutral"
    variant="ghost"
  >
    <span v-if="active" class="absolute -left-4 top-1/2 h-4.5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary-500" />
    <UIcon :name="icon" class="mr-2.5 h-5 w-5 shrink-0" :class="iconClass" />
    <span class="truncate text-xs font-medium">{{ title }}</span>
  </UButton>
</template>
