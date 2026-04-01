<script setup lang="ts">
/**
 * 统一加载状态组件
 * 支持三种场景：行内加载、页面加载、蒙层覆盖
 */

import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 加载提示文本 */
    text?: string
    /** 自定义高度（仅 inline 模式生效） */
    height?: string
    /** 显示模式：inline=行内, page=全屏页面, overlay=蒙层覆盖 */
    variant?: 'inline' | 'page' | 'overlay'
  }>(),
  {
    variant: 'inline',
  }
)

// 容器样式
const containerClass = computed(() => {
  const base = 'flex items-center justify-center'

  switch (props.variant) {
    case 'page':
      return `${base} h-full w-full`
    case 'overlay':
      return `${base} absolute inset-0 z-10 bg-white/50 backdrop-blur-sm dark:bg-gray-950/50`
    default:
      return `${base} ${props.height || 'py-8'}`
  }
})
</script>

<template>
  <div :class="containerClass">
    <div class="flex flex-col items-center justify-center text-center">
      <UIcon name="i-heroicons-arrow-path" class="h-6 w-6 animate-spin text-pink-500" />
      <p v-if="text" class="mt-2 text-sm text-gray-500">{{ text }}</p>
    </div>
  </div>
</template>
