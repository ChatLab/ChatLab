<script setup lang="ts">
/**
 * 统一卡片容器组件
 * 提供三种视觉变体，所有背景色通过 CSS 变量 (--color-card-bg / --color-card-dark) 驱动，
 * 为未来设置页色系配置预留扩展点。
 */
import { computed } from 'vue'
import CaptureButton from '@/components/common/CaptureButton.vue'

const props = withDefaults(
  defineProps<{
    /** 视觉变体 */
    variant?: 'section' | 'card' | 'elevated'
    /** 是否显示装饰性渐变光晕（仅 elevated 生效） */
    decorative?: boolean
    /** hover 时显示右上角截屏按钮 */
    capturable?: boolean
  }>(),
  {
    variant: 'section',
    decorative: false,
    capturable: true,
  }
)

const variantClasses: Record<string, string> = {
  section:
    'rounded-xl border border-gray-200 bg-card-bg shadow-sm dark:border-white/5 dark:bg-card-dark',
  card: 'rounded-[20px] border border-gray-200/60 bg-card-bg shadow-sm transition-all hover:shadow-md dark:border-white/5 dark:bg-card-dark',
  elevated:
    'rounded-[24px] bg-card-bg shadow-xl ring-1 ring-gray-900/5 dark:bg-card-dark dark:ring-white/10',
}

const containerClass = computed(() => {
  const base = `relative overflow-hidden ${variantClasses[props.variant]}`
  return props.capturable ? `group/card ${base}` : base
})

const showDecoration = computed(() => props.decorative && props.variant === 'elevated')
</script>

<template>
  <div :class="containerClass" :data-theme-card="capturable ? '' : undefined">
    <div v-if="showDecoration" class="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        class="absolute -left-[20%] -top-[20%] h-[70%] w-[70%] rounded-full bg-blue-400/10 blur-[80px] dark:bg-blue-500/20"
      />
      <div
        class="absolute -right-[20%] top-[10%] h-[70%] w-[70%] rounded-full bg-pink-400/10 blur-[80px] dark:bg-pink-500/20"
      />
    </div>

    <div
      v-if="capturable"
      class="absolute right-3 top-3 z-50 opacity-0 transition-opacity duration-200 group-hover/card:opacity-100"
    >
      <CaptureButton type="element" target-selector="[data-theme-card]" size="xs" />
    </div>

    <slot />
  </div>
</template>
