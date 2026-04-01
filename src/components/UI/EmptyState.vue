<script setup lang="ts">
/**
 * 空数据状态组件
 * 用于展示无数据时的提示
 */
defineProps<{
  /** 提示文字 */
  text?: string
  /** 可选的图标 */
  icon?: string
  /** 内边距大小 */
  padding?: 'sm' | 'md' | 'lg'
}>()

const paddingMap = {
  sm: 'px-4 py-4',
  md: 'px-5 py-8',
  lg: 'px-6 py-12',
}
</script>

<template>
  <div class="text-center text-sm text-gray-400" :class="paddingMap[padding || 'md']">
    <span v-if="icon" class="mb-2 block text-2xl">{{ icon }}</span>
    {{ text || '暂无数据' }}
  </div>
</template>
