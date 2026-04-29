<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { usePromptStore } from '@/stores/prompt'

const { t } = useI18n()

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

const enableAutoSkill = computed({
  get: () => aiGlobalSettings.value.enableAutoSkill ?? true,
  set: (val: boolean) => {
    promptStore.updateAIGlobalSettings({ enableAutoSkill: val })
    emit('config-changed')
  },
})

const searchContextBefore = computed({
  get: () => aiGlobalSettings.value.searchContextBefore ?? 3,
  set: (val: number) => {
    const clampedVal = Math.max(0, Math.min(20, val ?? 3))
    promptStore.updateAIGlobalSettings({ searchContextBefore: clampedVal })
    emit('config-changed')
  },
})

const searchContextAfter = computed({
  get: () => aiGlobalSettings.value.searchContextAfter ?? 3,
  set: (val: number) => {
    const clampedVal = Math.max(0, Math.min(20, val ?? 3))
    promptStore.updateAIGlobalSettings({ searchContextAfter: clampedVal })
    emit('config-changed')
  },
})

// 上下文压缩配置
const compressionEnabled = computed({
  get: () => aiGlobalSettings.value.contextCompression?.enabled ?? false,
  set: (val: boolean) => {
    promptStore.updateAIGlobalSettings({
      contextCompression: { ...aiGlobalSettings.value.contextCompression, enabled: val },
    })
    emit('config-changed')
  },
})

const compressionThreshold = computed({
  get: () => aiGlobalSettings.value.contextCompression?.tokenThresholdPercent ?? 75,
  set: (val: number) => {
    const clampedVal = Math.max(30, Math.min(95, val || 75))
    promptStore.updateAIGlobalSettings({
      contextCompression: { ...aiGlobalSettings.value.contextCompression, tokenThresholdPercent: clampedVal },
    })
    emit('config-changed')
  },
})

const compressionBuffer = computed({
  get: () => aiGlobalSettings.value.contextCompression?.bufferSizePercent ?? 20,
  set: (val: number) => {
    const clampedVal = Math.max(5, Math.min(50, val || 20))
    promptStore.updateAIGlobalSettings({
      contextCompression: { ...aiGlobalSettings.value.contextCompression, bufferSizePercent: clampedVal },
    })
    emit('config-changed')
  },
})

const maxToolResultPercent = computed({
  get: () => aiGlobalSettings.value.contextCompression?.maxToolResultPercent ?? 50,
  set: (val: number) => {
    const clampedVal = Math.max(10, Math.min(60, val || 50))
    promptStore.updateAIGlobalSettings({
      contextCompression: { ...aiGlobalSettings.value.contextCompression, maxToolResultPercent: clampedVal },
    })
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

        <!-- 搜索上下文窗口 -->
        <div>
          <div class="mb-2">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('settings.aiPrompt.searchContext.title') }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('settings.aiPrompt.searchContext.description') }}
            </p>
          </div>
          <div class="flex items-center gap-4">
            <div class="flex items-center gap-2">
              <span class="text-xs text-gray-500 dark:text-gray-400">
                {{ t('settings.aiPrompt.searchContext.before') }}
              </span>
              <UInputNumber v-model="searchContextBefore" :min="0" :max="20" class="w-24" />
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs text-gray-500 dark:text-gray-400">
                {{ t('settings.aiPrompt.searchContext.after') }}
              </span>
              <UInputNumber v-model="searchContextAfter" :min="0" :max="20" class="w-24" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 技能设置 -->
    <div>
      <h4 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-bolt" class="h-4 w-4 text-amber-500" />
        {{ t('settings.aiPrompt.skillSettings.title') }}
      </h4>
      <div class="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <div class="flex items-center justify-between">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('settings.aiPrompt.skillSettings.enableAutoSkill') }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('settings.aiPrompt.skillSettings.enableAutoSkillDesc') }}
            </p>
          </div>
          <USwitch v-model="enableAutoSkill" />
        </div>
      </div>
    </div>

    <!-- 上下文压缩设置 -->
    <div>
      <h4 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-archive-box-arrow-down" class="h-4 w-4 text-purple-500" />
        {{ t('settings.aiPrompt.compression.title') }}
      </h4>
      <div class="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <!-- 压缩开关 -->
        <div class="flex items-center justify-between">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('settings.aiPrompt.compression.enable') }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('settings.aiPrompt.compression.enableDesc') }}
            </p>
          </div>
          <USwitch v-model="compressionEnabled" />
        </div>

        <!-- 工具结果上限（始终显示，不依赖压缩开关） -->
        <div class="flex items-center justify-between">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('settings.aiPrompt.compression.maxToolResultPercent') }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('settings.aiPrompt.compression.maxToolResultPercentDesc') }}
            </p>
          </div>
          <div class="flex items-center gap-1">
            <UInputNumber v-model="maxToolResultPercent" :min="10" :max="60" class="w-24" />
            <span class="text-xs text-gray-400">%</span>
          </div>
        </div>

        <template v-if="compressionEnabled">
          <!-- 压缩阈值 -->
          <div class="flex items-center justify-between">
            <div class="flex-1 pr-4">
              <p class="text-sm font-medium text-gray-900 dark:text-white">
                {{ t('settings.aiPrompt.compression.threshold') }}
              </p>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {{ t('settings.aiPrompt.compression.thresholdDesc') }}
              </p>
            </div>
            <div class="flex items-center gap-1">
              <UInputNumber v-model="compressionThreshold" :min="30" :max="95" class="w-24" />
              <span class="text-xs text-gray-400">%</span>
            </div>
          </div>

          <!-- 缓冲区大小 -->
          <div class="flex items-center justify-between">
            <div class="flex-1 pr-4">
              <p class="text-sm font-medium text-gray-900 dark:text-white">
                {{ t('settings.aiPrompt.compression.buffer') }}
              </p>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {{ t('settings.aiPrompt.compression.bufferDesc') }}
              </p>
            </div>
            <div class="flex items-center gap-1">
              <UInputNumber v-model="compressionBuffer" :min="5" :max="50" class="w-24" />
              <span class="text-xs text-gray-400">%</span>
            </div>
          </div>
        </template>
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
