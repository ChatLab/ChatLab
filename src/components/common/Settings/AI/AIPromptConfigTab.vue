<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { usePromptStore } from '@/stores/prompt'
import type { ChartAutoMode } from '@openchatlab/shared-types'

const { t } = useI18n()

const promptStore = usePromptStore()
const { aiGlobalSettings } = storeToRefs(promptStore)

const props = defineProps<{
  setSectionRef?: (id: string, el: HTMLElement | null) => void
}>()

// Emits
const emit = defineEmits<{
  'config-changed': []
}>()

function setPromptSectionRef(id: string, el: HTMLElement | null) {
  props.setSectionRef?.(id, el)
}

// 发送条数限制
const globalMaxMessages = computed({
  get: () => aiGlobalSettings.value.maxMessagesPerRequest,
  set: (val: number) => {
    const clampedVal = Math.max(0, Math.min(50000, val || 1000))
    promptStore.updateAIGlobalSettings({ maxMessagesPerRequest: clampedVal })
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

const chartAutoModeOptions = computed(() => [
  { label: t('settings.aiPrompt.chatPreferences.chartAutoMode.explicit'), value: 'explicit' },
  { label: t('settings.aiPrompt.chatPreferences.chartAutoMode.suggest'), value: 'suggest' },
  { label: t('settings.aiPrompt.chatPreferences.chartAutoMode.aggressive'), value: 'aggressive' },
])

const chartAutoMode = computed({
  get: () => aiGlobalSettings.value.chartAutoMode ?? 'suggest',
  set: (val: ChartAutoMode) => {
    promptStore.updateAIGlobalSettings({ chartAutoMode: val })
    emit('config-changed')
  },
})

const chartAutoModeHint = computed(() =>
  t(`settings.aiPrompt.chatPreferences.chartAutoMode.${chartAutoMode.value}Hint`)
)

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
    const clampedVal = Math.max(10, Math.min(80, val || 50))
    promptStore.updateAIGlobalSettings({
      contextCompression: { ...aiGlobalSettings.value.contextCompression, maxToolResultPercent: clampedVal },
    })
    emit('config-changed')
  },
})
</script>

<template>
  <div class="space-y-6">
    <!-- 对话偏好 -->
    <div :ref="(el) => setPromptSectionRef('skill', el as HTMLElement | null)">
      <h4 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <UIcon name="i-heroicons-bolt" class="h-4 w-4 text-amber-500" />
        {{ t('settings.aiPrompt.chatPreferences.title') }}
      </h4>
      <div class="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <div class="flex items-center justify-between">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('settings.aiPrompt.chatPreferences.enableAutoSkill') }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('settings.aiPrompt.chatPreferences.enableAutoSkillDesc') }}
            </p>
          </div>
          <USwitch v-model="enableAutoSkill" />
        </div>

        <div class="flex items-center justify-between">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('settings.aiPrompt.chatPreferences.chartAutoMode.title') }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('settings.aiPrompt.chatPreferences.chartAutoMode.description') }}
            </p>
          </div>
          <div class="flex flex-col items-end gap-1">
            <UTabs v-model="chartAutoMode" :items="chartAutoModeOptions" :disabled="!enableAutoSkill" size="xs" />
            <p class="max-w-64 text-right text-xs text-gray-500 dark:text-gray-400">
              {{ chartAutoModeHint }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- 工具设置 -->
    <div :ref="(el) => setPromptSectionRef('chat', el as HTMLElement | null)">
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

    <!-- 上下文压缩设置 -->
    <div :ref="(el) => setPromptSectionRef('compression', el as HTMLElement | null)">
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
            <UInputNumber v-model="maxToolResultPercent" :min="10" :max="80" class="w-24" />
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
  </div>
</template>
