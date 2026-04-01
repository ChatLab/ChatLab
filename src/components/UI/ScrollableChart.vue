<script setup lang="ts">
/**
 * 可滚动图表容器
 * 提供最大高度限制和自动滚动功能
 */
import { computed } from 'vue'

interface Props {
  /** 内容实际高度（像素） */
  contentHeight: number
  /** 最大高度（vh 单位），默认 60vh */
  maxHeightVh?: number
  /** 内边距类名 */
  paddingClass?: string
}

const props = withDefaults(defineProps<Props>(), {
  maxHeightVh: 60,
  paddingClass: 'px-3 py-2',
})

// 计算最大高度（像素）
const maxHeightPx = computed(() => {
  if (typeof window === 'undefined') return 500
  return Math.round((window.innerHeight * props.maxHeightVh) / 100)
})

// 是否需要滚动
const needScroll = computed(() => props.contentHeight > maxHeightPx.value)

// 容器样式
const containerStyle = computed(() => ({
  maxHeight: `${props.maxHeightVh}vh`,
  overflowY: (needScroll.value ? 'auto' : 'hidden') as 'auto' | 'hidden',
}))
</script>

<template>
  <div :class="paddingClass" :style="containerStyle">
    <slot />
  </div>
</template>
