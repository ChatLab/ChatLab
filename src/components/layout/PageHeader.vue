<script setup lang="ts">
/**
 * 页面 Header 通用组件
 * 包含标题、描述、可选头像/图标，以及默认 slot 用于额外内容
 */

defineProps<{
  title: string
  description?: string
  icon?: string // fallback 图标
  iconClass?: string // 图标背景样式类
  avatar?: string | null // 头像图片（base64 Data URL），优先级高于 icon
}>()
</script>

<template>
  <div class="relative border-b border-gray-200/50 px-6 pb-2 dark:border-gray-800/50">
    <!-- 拖拽区域 - 覆盖顶部安全区域（平台自适应）
         macOS: 16px padding + 16px = 32px | Windows/Linux: 32px padding + 16px = 48px -->
    <div class="titlebar-drag-cover" />

    <!-- 标题区域 -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <!-- 头像图片（优先显示） -->
        <img v-if="avatar" :src="avatar" :alt="title" class="h-10 w-10 rounded-xl object-cover" />
        <!-- 可选图标（fallback） -->
        <div v-else-if="icon" class="flex h-10 w-10 items-center justify-center rounded-xl" :class="iconClass">
          <UIcon :name="icon" class="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 class="text-lg font-semibold text-gray-900 dark:text-white">
            {{ title }}
          </h1>
          <p v-if="description" class="text-xs text-gray-500 dark:text-gray-400">
            {{ description }}
          </p>
        </div>
      </div>

      <!-- 中间拖拽占位符 - 填充中间空白区域 -->
      <div class="flex-1 self-stretch mx-4" style="-webkit-app-region: drag" />

      <!-- 右侧操作区域 -->
      <div class="flex items-center gap-2">
        <slot name="actions" />
      </div>
    </div>

    <!-- 额外内容 slot（如 Tabs） -->
    <slot />
  </div>
</template>

<style scoped>
/* 标题栏拖拽覆盖区域 - 使用 CSS 变量实现平台自适应高度 */
.titlebar-drag-cover {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 50;
  top: calc(-1 * var(--titlebar-area-height));
  height: calc(var(--titlebar-area-height) + 1rem);
  -webkit-app-region: drag;
}
</style>
