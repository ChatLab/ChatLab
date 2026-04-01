<script setup lang="ts">
interface Props {
  percentage: number
  color?: string
  height?: number
  showLabel?: boolean
  animated?: boolean
}

withDefaults(defineProps<Props>(), {
  color: 'from-pink-400 to-pink-600',
  height: 8,
  showLabel: false,
  animated: true,
})
</script>

<template>
  <div class="flex items-center gap-3">
    <div class="flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800" :style="{ height: `${height}px` }">
      <div
        class="h-full rounded-full bg-linear-to-r"
        :class="[color, animated ? 'transition-all duration-500' : '']"
        :style="{ width: `${percentage}%` }"
      />
    </div>
    <span v-if="showLabel" class="text-sm text-gray-500 dark:text-gray-400">{{ percentage }}%</span>
  </div>
</template>
