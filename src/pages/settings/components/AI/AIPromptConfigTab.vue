<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { usePromptStore } from '@/stores/prompt'

const { t } = useI18n()

// Store
const promptStore = usePromptStore()
const { aiGlobalSettings } = storeToRefs(promptStore)

// Emits
const emit = defineEmits<{
  'config-changed': []
}>()

// 发送条数限制
const globalMaxMessages = computed({
  get: () => aiGlobalSettings.value.maxMessagesPerRequest,
  set: (val: number) => {
    const clampedVal = Math.max(0, Math.min(50000, val || 1000))
    promptStore.updateAIGlobalSettings({ maxMessagesPerRequest: clampedVal })
    emit('config-changed')
  },
})

// AI上下文限制
const globalMaxHistoryRounds = computed({
  get: () => aiGlobalSettings.value.maxHistoryRounds ?? 10,
  set: (val: number) => {
    const clampedVal = Math.max(1, Math.min(50, val || 10))
    promptStore.updateAIGlobalSettings({ maxHistoryRounds: clampedVal })
    emit('config-changed')
  },
})

// 导出格式选项（AI 对话）
const exportFormatTabs = computed(() => [
  { label: 'Markdown', value: 'markdown' },
  { label: t('settings.aiPrompt.exportFormat.txtLabel'), value: 'txt' },
])

// 当前选中的导出格式（AI 对话）
const exportFormat = computed({
  get: () => aiGlobalSettings.value.exportFormat ?? 'markdown',
  set: (val: string) => {
    promptStore.updateAIGlobalSettings({ exportFormat: val as 'markdown' | 'txt' })
    emit('config-changed')
  },
})

// SQL Lab 导出格式选项
const sqlExportFormatTabs = computed(() => [
  { label: 'CSV', value: 'csv' },
  { label: 'JSON', value: 'json' },
])

// 当前选中的 SQL Lab 导出格式
const sqlExportFormat = computed({
  get: () => aiGlobalSettings.value.sqlExportFormat ?? 'csv',
  set: (val: string) => {
    promptStore.updateAIGlobalSettings({ sqlExportFormat: val as 'csv' | 'json' })
    emit('config-changed')
  },
})
</script>

<template>
  <div class="space-y-6">
    <!-- 对话设置 -->
    <div>
      <h4 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-chat-bubble-left-right" class="h-4 w-4 text-green-500" />
        {{ t('settings.aiPrompt.chatSettings.title') }}
      </h4>
      <div class="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <!-- 发送条数限制 -->
        <div class="flex items-center justify-between">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('settings.aiPrompt.maxMessages.title') }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('settings.aiPrompt.maxMessages.description') }}
            </p>
          </div>
          <UInputNumber v-model="globalMaxMessages" :min="0" :max="50000" class="w-30" />
        </div>

        <!-- AI上下文限制 -->
        <div class="flex items-center justify-between">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('settings.aiPrompt.maxHistory.title') }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('settings.aiPrompt.maxHistory.description') }}
            </p>
          </div>
          <UInputNumber v-model="globalMaxHistoryRounds" :min="1" :max="50" class="w-30" />
        </div>
      </div>
    </div>

    <!-- 导出设置 -->
    <div>
      <h4 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-arrow-down-tray" class="h-4 w-4 text-blue-500" />
        {{ t('settings.aiPrompt.exportSettings.title') }}
      </h4>
      <div class="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <!-- 导出格式（AI 对话） -->
        <div class="flex items-center justify-between">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('settings.aiPrompt.exportFormat.title') }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('settings.aiPrompt.exportFormat.description') }}
            </p>
          </div>
          <UTabs v-model="exportFormat" :items="exportFormatTabs" size="xs" />
        </div>

        <!-- SQL Lab 导出格式 -->
        <div class="flex items-center justify-between">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('settings.aiPrompt.sqlExportFormat.title') }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('settings.aiPrompt.sqlExportFormat.description') }}
            </p>
          </div>
          <UTabs v-model="sqlExportFormat" :items="sqlExportFormatTabs" size="xs" />
        </div>
      </div>
    </div>
  </div>
</template>
