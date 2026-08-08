<script setup lang="ts">
/**
 * 统一加载状态组件
 * 支持行内加载、页面加载和蒙层覆盖
 */

import { computed, ref } from 'vue'
import { useInsightViewLoading } from './insight-view-loading'
import LoadingDots from './LoadingDots.vue'

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
      return `${base} absolute inset-0 z-10 cursor-wait bg-page-bg dark:bg-page-dark`
    default:
      return `${base} ${props.height || 'py-8'}`
  }
})

const pageLoadingCoordinator = useInsightViewLoading(ref(true))
const isCoordinatedPageLoading = computed(
  () => pageLoadingCoordinator !== null && (pageLoadingCoordinator.suppress?.value ?? true)
)
const usePageIndicator = computed(() => props.variant === 'page' || props.variant === 'overlay')
</script>

<template>
  <div v-if="!isCoordinatedPageLoading" :class="containerClass" role="status" aria-live="polite">
    <div class="flex flex-col items-center justify-center text-center">
      <LoadingDots v-if="usePageIndicator" />
      <UIcon v-else name="i-heroicons-arrow-path" class="h-6 w-6 animate-spin text-pink-500" />
      <p v-if="text" class="mt-2 text-sm text-gray-500">{{ text }}</p>
    </div>
  </div>
</template>
