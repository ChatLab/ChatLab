<script setup lang="ts">
import type { AssistantSummary } from '@/stores/assistant'

defineProps<{
  assistant: AssistantSummary
  selected?: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
  configure: [id: string]
}>()
</script>

<template>
  <div
    class="group relative cursor-pointer rounded-xl border-2 p-4 transition-all duration-200"
    :class="[
      selected
        ? 'border-primary-500 bg-primary-50 shadow-md dark:border-primary-400 dark:bg-primary-950/30'
        : 'border-gray-200 bg-white hover:border-primary-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-800 dark:hover:border-primary-600',
    ]"
    @click="emit('select', assistant.id)"
  >
    <!-- 配置按钮 -->
    <button
      class="absolute right-2 top-2 rounded-lg p-1.5 text-gray-400 opacity-0 transition-all hover:bg-gray-100 hover:text-gray-600 group-hover:opacity-100 dark:hover:bg-gray-700 dark:hover:text-gray-300"
      @click.stop="emit('configure', assistant.id)"
    >
      <UIcon name="i-heroicons-pencil-square" class="h-4 w-4" />
    </button>

    <!-- 名称 -->
    <h3 class="mb-1.5 truncate pr-6 text-sm font-semibold text-gray-900 dark:text-gray-100">
      {{ assistant.name }}
    </h3>

    <!-- 系统提示词预览 -->
    <p class="line-clamp-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
      {{ assistant.systemPrompt }}
    </p>
  </div>
</template>
