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
  <UPopover mode="hover" :open-delay="120" :close-delay="80">
    <div
      class="group relative flex h-[46px] cursor-pointer items-center rounded-lg border px-3.5 pr-8 transition-all duration-200"
      :class="[
        selected
          ? 'border-primary-500 bg-primary-50 shadow-md dark:border-primary-400 dark:bg-primary-950/30'
          : 'border-gray-200 bg-white hover:border-primary-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-800 dark:hover:border-primary-600',
      ]"
      @click="emit('select', assistant.id)"
    >
      <!-- 配置按钮 -->
      <button
        class="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-400 opacity-0 transition-all hover:bg-gray-100 hover:text-gray-600 group-hover:opacity-100 dark:hover:bg-gray-700 dark:hover:text-gray-300"
        @click.stop="emit('configure', assistant.id)"
      >
        <UIcon name="i-heroicons-pencil-square" class="h-4 w-4" />
      </button>

      <!-- 卡片默认只展示助手名称，完整系统提示词改为悬停查看。 -->
      <h3 class="pr-1 text-sm font-medium leading-none text-gray-900 dark:text-gray-100">
        {{ assistant.name }}
      </h3>
    </div>

    <template #content>
      <div
        class="max-h-72 max-w-sm overflow-y-auto px-3 py-2 text-xs leading-5 whitespace-pre-wrap text-gray-600 dark:text-gray-300"
      >
        {{ assistant.systemPrompt }}
      </div>
    </template>
  </UPopover>
</template>
