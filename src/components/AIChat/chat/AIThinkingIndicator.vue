<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t, te } = useI18n()

// 获取工具的本地化显示名称
function localizedToolName(name: string, fallback?: string): string {
  const key = `ai.chat.message.tools.${name}`
  return te(key) ? t(key) : fallback || name
}

// Props
defineProps<{
  // 当前工具执行状态
  currentToolStatus: {
    name: string
    displayName: string
    status: 'running' | 'done' | 'error'
  } | null
  // 当前轮次已使用的工具列表
  toolsUsed: string[]
}>()
</script>

<template>
  <div class="flex items-start gap-3">
    <!-- AI 头像 -->
    <div
      class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-pink-500 to-pink-600"
    >
      <UIcon name="i-heroicons-sparkles" class="h-4 w-4 text-white" />
    </div>

    <!-- 状态气泡 -->
    <div class="rounded-2xl rounded-tl-sm bg-gray-100 px-4 py-3 dark:bg-gray-800">
      <!-- 工具执行状态 -->
      <div v-if="currentToolStatus" class="space-y-2">
        <div class="flex items-center gap-2">
          <span
            class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
            :class="[
              currentToolStatus.status === 'running'
                ? 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300'
                : currentToolStatus.status === 'done'
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                  : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
            ]"
          >
            <UIcon
              :name="
                currentToolStatus.status === 'running'
                  ? 'i-heroicons-cog-6-tooth'
                  : currentToolStatus.status === 'done'
                    ? 'i-heroicons-check-circle'
                    : 'i-heroicons-x-circle'
              "
              class="h-3 w-3"
              :class="{ 'animate-spin': currentToolStatus.status === 'running' }"
            />
            {{ localizedToolName(currentToolStatus.name, currentToolStatus.displayName) }}
          </span>

          <!-- 运行中的动画 -->
          <span v-if="currentToolStatus.status === 'running'" class="flex gap-1">
            <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-pink-500 [animation-delay:0ms]" />
            <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-pink-500 [animation-delay:150ms]" />
            <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-pink-500 [animation-delay:300ms]" />
          </span>

          <!-- 完成后处理中状态 -->
          <span
            v-else-if="currentToolStatus.status === 'done'"
            class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400"
          >
            <span>{{ t('ai.chat.thinking.processingResult') }}</span>
            <span class="flex gap-1">
              <span class="h-1 w-1 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
              <span class="h-1 w-1 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
              <span class="h-1 w-1 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
            </span>
          </span>
        </div>

        <!-- 已使用的工具列表 -->
        <div v-if="toolsUsed.length > 1" class="flex flex-wrap gap-1">
          <span class="text-xs text-gray-400">{{ t('ai.chat.thinking.called') }}</span>
          <span
            v-for="tool in toolsUsed.slice(0, -1)"
            :key="tool"
            class="inline-flex items-center gap-1 rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-400"
          >
            <UIcon name="i-heroicons-check" class="h-3 w-3 text-green-500" />
            {{ localizedToolName(tool) }}
          </span>
        </div>
      </div>

      <!-- 默认状态（无工具调用） -->
      <div v-else class="flex items-center gap-2">
        <span class="text-sm text-gray-600 dark:text-gray-400">{{ t('ai.chat.thinking.analyzing') }}</span>
        <span class="flex gap-1">
          <span class="h-2 w-2 animate-bounce rounded-full bg-pink-500 [animation-delay:0ms]" />
          <span class="h-2 w-2 animate-bounce rounded-full bg-pink-500 [animation-delay:150ms]" />
          <span class="h-2 w-2 animate-bounce rounded-full bg-pink-500 [animation-delay:300ms]" />
        </span>
      </div>
    </div>
  </div>
</template>
