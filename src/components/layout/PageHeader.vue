<script setup lang="ts">
/**
 * 页面 Header 通用组件
 * 包含标题、描述、可选头像/图标，以及默认 slot 用于额外内容
 */

const props = withDefaults(
  defineProps<{
    title: string
    description?: string
    icon?: string // fallback 图标
    iconClass?: string // 图标背景样式类
    avatar?: string | null // 头像图片（base64 Data URL），优先级高于 icon
    size?: 'default' | 'compact' // 紧凑模式用于需要更小头部高度的页面
  }>(),
  {
    size: 'default',
  }
)
</script>

<template>
  <div
    class="relative border-b border-gray-200/50 dark:border-gray-800/50"
    :class="props.size === 'compact' ? 'px-5 pb-1.5' : 'px-6 pb-2'"
  >
    <!-- 拖拽区域 - 覆盖顶部安全区域（平台自适应）
         macOS: 16px padding + 16px = 32px | Windows/Linux: 32px padding + 16px = 48px -->
    <div class="titlebar-drag-cover" />

    <!-- 标题区域 -->
    <div class="flex items-center justify-between">
      <div class="flex items-center" :class="props.size === 'compact' ? 'gap-2.5' : 'gap-3'">
        <!-- 头像图片（优先显示） -->
        <img
          v-if="avatar"
          :src="avatar"
          :alt="title"
          class="object-cover"
          :class="props.size === 'compact' ? 'h-8 w-8 rounded-lg' : 'h-10 w-10 rounded-xl'"
        />
        <!-- 可选图标（fallback） -->
        <div
          v-else-if="icon"
          class="flex items-center justify-center"
          :class="[iconClass, props.size === 'compact' ? 'h-8 w-8 rounded-lg' : 'h-10 w-10 rounded-xl']"
        >
          <UIcon :name="icon" class="text-white" :class="props.size === 'compact' ? 'h-4 w-4' : 'h-5 w-5'" />
        </div>
        <div>
          <h1
            class="font-semibold text-gray-900 dark:text-white"
            :class="props.size === 'compact' ? 'text-base' : 'text-lg'"
          >
            {{ title }}
          </h1>
          <p
            v-if="description"
            class="text-gray-500 dark:text-gray-400"
            :class="props.size === 'compact' ? 'text-[11px]' : 'text-xs'"
          >
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
