<script setup lang="ts">
/**
 * 带标题的卡片容器组件
 * 统一的分析模块卡片样式
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 卡片标题 */
    title: string
    /** 可选的描述文字 */
    description?: string
    /** 是否显示边框分隔线（默认 true） */
    showDivider?: boolean
    /** 是否启用内容滚动 */
    scrollable?: boolean
    /** 最大高度（vh 单位），默认 60vh */
    maxHeightVh?: number
  }>(),
  {
    showDivider: true,
    scrollable: false,
    maxHeightVh: 60,
  }
)

// 内容区域样式
const contentStyle = computed(() => {
  if (!props.scrollable) return undefined
  return {
    maxHeight: `${props.maxHeightVh}vh`,
    overflowY: 'auto' as const,
  }
})
</script>

<template>
  <div class="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-white/5 dark:bg-card-dark">
    <!-- 标题区域 -->
    <div class="px-5 py-3" :class="{ 'border-b border-gray-200 dark:border-white/5': showDivider && $slots.default }">
      <div class="flex items-center justify-between">
        <div>
          <p class="font-semibold text-gray-900 dark:text-white whitespace-nowrap">{{ title }}</p>
          <p v-if="description" class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {{ description }}
          </p>
        </div>
        <!-- 标题右侧插槽 -->
        <slot name="headerRight" />
      </div>
    </div>

    <!-- 内容区域 -->
    <div v-if="scrollable" :style="contentStyle">
      <slot />
    </div>
    <slot v-else />

    <!-- 底部区域（在滚动区域外） -->
    <slot name="footer" />
  </div>
</template>
