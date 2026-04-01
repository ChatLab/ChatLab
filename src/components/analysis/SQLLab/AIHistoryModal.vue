<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { AIHistory } from './types'

const { t } = useI18n()

// Props
defineProps<{
  open: boolean
  history: AIHistory[]
}>()

// Emits
const emit = defineEmits<{
  'update:open': [value: boolean]
  execute: [record: AIHistory]
  delete: [id: string]
}>()

// 格式化时间
function formatHistoryTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - timestamp

  if (diff < 60000) return t('ai.sqlLab.history.justNow')
  if (diff < 3600000) return t('ai.sqlLab.history.minutesAgo', { count: Math.floor(diff / 60000) })
  if (diff < 86400000) return t('ai.sqlLab.history.hoursAgo', { count: Math.floor(diff / 3600000) })
  if (date.toDateString() === now.toDateString()) return t('ai.sqlLab.history.today')

  return `${date.getMonth() + 1}/${date.getDate()}`
}
</script>

<template>
  <UModal :open="open" @update:open="emit('update:open', $event)">
    <template #content>
      <div class="max-h-[70vh] overflow-hidden p-6">
        <div class="mb-4 flex items-center gap-2">
          <UIcon name="i-heroicons-clock" class="h-5 w-5 text-pink-500" />
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('ai.sqlLab.history.title') }}</h3>
        </div>

        <!-- 历史列表 -->
        <div v-if="history.length > 0" class="max-h-[50vh] space-y-3 overflow-y-auto pr-2">
          <div
            v-for="record in history"
            :key="record.id"
            class="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900"
          >
            <!-- 头部：用户输入 + 时间 -->
            <div class="mb-2 flex items-start justify-between gap-2">
              <p class="flex-1 text-sm font-medium text-gray-700 dark:text-gray-300">{{ record.prompt }}</p>
              <span class="shrink-0 text-xs text-gray-400">{{ formatHistoryTime(record.timestamp) }}</span>
            </div>

            <!-- SQL -->
            <div class="mb-2 rounded bg-white p-2 dark:bg-gray-800">
              <pre class="whitespace-pre-wrap break-all font-mono text-xs text-gray-600 dark:text-gray-400">{{
                record.sql
              }}</pre>
            </div>

            <!-- 说明 -->
            <p v-if="record.explanation" class="mb-2 text-xs text-gray-500 dark:text-gray-400">
              {{ record.explanation }}
            </p>

            <!-- 操作按钮 -->
            <div class="flex justify-end gap-2">
              <UButton variant="ghost" size="xs" color="error" @click="emit('delete', record.id)">
                <UIcon name="i-heroicons-trash" class="h-3.5 w-3.5" />
              </UButton>
              <UButton size="xs" @click="emit('execute', record)">
                <UIcon name="i-heroicons-play" class="mr-1 h-3.5 w-3.5" />
                {{ t('ai.sqlLab.history.execute') }}
              </UButton>
            </div>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-else class="py-8 text-center text-gray-500 dark:text-gray-400">
          <UIcon name="i-heroicons-clock" class="mx-auto mb-2 h-8 w-8 text-gray-300 dark:text-gray-600" />
          <p class="text-sm">{{ t('ai.sqlLab.history.empty') }}</p>
        </div>

        <!-- 底部按钮 -->
        <div class="mt-4 flex justify-end">
          <UButton variant="ghost" @click="emit('update:open', false)">{{ t('common.close') }}</UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
