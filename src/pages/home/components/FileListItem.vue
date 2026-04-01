<script setup lang="ts">
/**
 * 文件列表项组件
 * 用于批量导入/合并导入的文件列表显示
 */
defineProps<{
  /** 文件名 */
  name: string
  /** 状态图标名称 */
  statusIcon: string
  /** 状态图标样式类 */
  statusClass: string
  /** 进度/状态描述文本 */
  progressText?: string
  /** 当前索引（从0开始） */
  index: number
  /** 总数 */
  total: number
  /** 是否高亮当前项 */
  highlight?: boolean
}>()
</script>

<template>
  <div
    class="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors"
    :class="{ 'bg-pink-50/50 dark:bg-pink-500/5': highlight }"
  >
    <UIcon :name="statusIcon" class="h-5 w-5 shrink-0" :class="statusClass" />
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-medium text-gray-900 dark:text-white">
        {{ name }}
      </p>
      <p v-if="progressText" class="text-xs text-gray-500 dark:text-gray-400">
        {{ progressText }}
      </p>
      <!-- 额外内容插槽（如错误信息、操作按钮等） -->
      <slot name="extra" />
    </div>
    <span class="text-xs text-gray-400">{{ index + 1 }}/{{ total }}</span>
    <!-- 操作按钮插槽 -->
    <slot name="action" />
  </div>
</template>
