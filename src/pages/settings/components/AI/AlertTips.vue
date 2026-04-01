<script setup lang="ts">
/**
 * 通用提示组件
 * 支持通过 props 传入 icon 和 html 内容
 */
defineProps<{
  /** 图标名称（iconify 格式） */
  icon?: string
  /** HTML 内容（通过 v-html 渲染） */
  content: string
  /** 提示颜色，默认 error */
  color?: 'error' | 'warning' | 'info' | 'success'
}>()
</script>

<template>
  <UAlert :color="color || 'error'" variant="outline" :icon="icon || 'i-lucide-terminal'" class="p-2">
    <template #title>
      <p v-html="content" />
    </template>
  </UAlert>
</template>
