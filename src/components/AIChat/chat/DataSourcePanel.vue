<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'

const { t } = useI18n()

// Props
const props = defineProps<{
  messages: Array<{
    id: number
    senderName: string
    content: string
    timestamp: number
  }>
  keywords: string[]
  isLoading: boolean
  isCollapsed: boolean
}>()

// Emits
const emit = defineEmits<{
  toggle: []
  loadMore: []
}>()

// 格式化时间
function formatTime(timestamp: number): string {
  return dayjs(timestamp).format('MM-DD HH:mm')
}

// 高亮关键词
function highlightKeywords(text: string): string {
  if (!props.keywords.length) return text
  const pattern = props.keywords.join('|')
  const regex = new RegExp(`(${pattern})`, 'gi')
  return text.replace(regex, '<mark class="bg-yellow-200 dark:bg-yellow-800/50 px-0.5 rounded">$1</mark>')
}
</script>

<template>
  <div
    class="relative flex flex-col rounded-xl bg-white shadow-sm transition-all duration-300 dark:bg-gray-900"
    :class="[isCollapsed ? 'w-12' : 'w-full']"
  >
    <!-- 折叠状态 -->
    <template v-if="isCollapsed">
      <button
        class="flex h-full flex-col items-center justify-center gap-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        @click="emit('toggle')"
      >
        <UIcon name="i-heroicons-chevron-left" class="h-5 w-5" />
        <span class="writing-vertical text-xs">{{ t('ai.chat.dataSource.title') }}</span>
      </button>
    </template>

    <!-- 展开状态 -->
    <template v-else>
      <!-- 头部 -->
      <div class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
        <div class="flex items-center gap-2">
          <UIcon name="i-heroicons-document-magnifying-glass" class="h-5 w-5 text-gray-500" />
          <span class="font-medium text-gray-900 dark:text-white">{{ t('ai.chat.dataSource.title') }}</span>
        </div>
        <UButton icon="i-heroicons-chevron-right" color="gray" variant="ghost" size="xs" @click="emit('toggle')" />
      </div>

      <!-- 当前关键词 -->
      <div v-if="keywords.length > 0" class="border-b border-gray-200 px-4 py-2 dark:border-gray-800">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-xs text-gray-500">{{ t('ai.chat.dataSource.keywords') }}</span>
          <span
            v-for="kw in keywords"
            :key="kw"
            class="rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-700 dark:bg-violet-900/30 dark:text-violet-400"
          >
            {{ kw }}
          </span>
        </div>
      </div>

      <!-- 消息列表 -->
      <div class="flex-1 overflow-y-auto">
        <!-- 加载中 -->
        <div v-if="isLoading" class="flex items-center justify-center py-8">
          <UIcon name="i-heroicons-arrow-path" class="h-6 w-6 animate-spin text-gray-400" />
        </div>

        <!-- 空状态 -->
        <div v-else-if="messages.length === 0" class="flex flex-col items-center justify-center py-8 text-center">
          <UIcon name="i-heroicons-inbox" class="h-10 w-10 text-gray-300 dark:text-gray-600" />
          <p class="mt-2 text-sm text-gray-500">{{ t('ai.chat.dataSource.empty') }}</p>
          <p class="text-xs text-gray-400">{{ t('ai.chat.dataSource.emptyHint') }}</p>
        </div>

        <!-- 消息列表 -->
        <div v-else class="divide-y divide-gray-100 dark:divide-gray-800">
          <div
            v-for="msg in messages"
            :key="msg.id"
            class="px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
          >
            <div class="mb-1 flex items-center justify-between">
              <span class="text-sm font-medium text-gray-900 dark:text-white">
                {{ msg.senderName }}
              </span>
              <span class="text-xs text-gray-400">{{ formatTime(msg.timestamp) }}</span>
            </div>
            <p class="line-clamp-3 text-sm text-gray-600 dark:text-gray-400" v-html="highlightKeywords(msg.content)" />
          </div>
        </div>
      </div>

      <!-- 底部统计 & 加载更多 -->
      <div v-if="messages.length > 0" class="border-t border-gray-200 px-4 py-2 dark:border-gray-800">
        <div class="flex items-center justify-between">
          <span class="text-xs text-gray-500">
            {{ t('ai.chat.dataSource.totalRecords', { count: messages.length }) }}
          </span>
          <UButton size="xs" variant="ghost" @click="emit('loadMore')">{{ t('ai.chat.dataSource.loadMore') }}</UButton>
        </div>
      </div>
    </template>

    <!-- 半透明数据流背景效果 -->
    <div v-if="!isCollapsed" class="pointer-events-none absolute inset-0 overflow-hidden rounded-xl opacity-[0.03]">
      <div class="data-flow-bg absolute inset-0" />
    </div>
  </div>
</template>

<style scoped>
.writing-vertical {
  writing-mode: vertical-rl;
  text-orientation: mixed;
}

/* 数据流背景动画 */
.data-flow-bg {
  background: repeating-linear-gradient(0deg, transparent, transparent 20px, currentColor 20px, currentColor 21px);
  animation: dataFlow 20s linear infinite;
}

@keyframes dataFlow {
  0% {
    transform: translateY(0);
  }
  100% {
    transform: translateY(-100px);
  }
}
</style>
