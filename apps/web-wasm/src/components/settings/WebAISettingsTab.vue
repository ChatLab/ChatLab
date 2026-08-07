<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import {
  normalizeWebAIError,
  type SaveWebModelConfigInput,
  type WebAIConnectionTestResult,
} from '@openchatlab/web-ai-runtime'
import { useToast } from '@/composables/useToast'
import { reportRuntimeLog } from '@/services/log-report'
import WebAIModelSetupModal from '../ai/WebAIModelSetupModal.vue'
import { useWebAISettingsStore } from '../../stores/web-ai-settings'
import { runWithSavingState } from '../ai/save-state'

const { t } = useI18n()
const toast = useToast()
const settingsStore = useWebAISettingsStore()
const { config } = storeToRefs(settingsStore)
const setupModal = ref<InstanceType<typeof WebAIModelSetupModal> | null>(null)
const setupOpen = ref(false)
const loading = ref(true)
const testing = ref(false)
const saving = ref(false)
const removing = ref(false)

onMounted(async () => {
  try {
    await settingsStore.loadConfig()
  } finally {
    loading.value = false
  }
})

async function testConnection(input: SaveWebModelConfigInput) {
  testing.value = true
  try {
    setupModal.value?.setTestResult(await settingsStore.testConnection(input))
  } finally {
    testing.value = false
  }
}

async function saveConfig(input: SaveWebModelConfigInput) {
  try {
    await runWithSavingState(
      (value) => {
        saving.value = value
      },
      async () => {
        const result: WebAIConnectionTestResult = await settingsStore.testConnection(input)
        setupModal.value?.setTestResult(result)
        if (!result.ok) return

        await settingsStore.saveConfig(input)
        reportRuntimeLog({
          level: 'info',
          scope: 'web-ai',
          message: 'Browser model configuration saved',
          data: { provider: input.provider, model: input.model },
        })
        setupOpen.value = false
        toast.success(t('webAI.config.saved'))
      }
    )
  } catch (error) {
    const normalized = normalizeWebAIError(error)
    setupModal.value?.setTestResult({ ok: false, error: normalized.data })
    reportRuntimeLog({
      level: 'error',
      scope: 'web-ai',
      message: 'Browser model configuration save failed',
      data: { code: normalized.data.code },
    })
  }
}

async function removeConfig() {
  if (!window.confirm(t('webAI.config.removeConfirm'))) return
  try {
    await runWithSavingState(
      (value) => {
        removing.value = value
      },
      async () => {
        await settingsStore.removeConfig()
        reportRuntimeLog({ level: 'info', scope: 'web-ai', message: 'Browser model configuration removed' })
        setupOpen.value = false
        toast.success(t('webAI.config.removed'))
      }
    )
  } catch (error) {
    const normalized = normalizeWebAIError(error)
    setupModal.value?.setTestResult({ ok: false, error: normalized.data })
    reportRuntimeLog({
      level: 'error',
      scope: 'web-ai',
      message: 'Browser model configuration removal failed',
      data: { code: normalized.data.code },
    })
  }
}
</script>

<template>
  <div>
    <div class="space-y-6 pb-6">
      <div>
        <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
          <UIcon name="i-heroicons-sparkles" class="h-4 w-4 text-violet-500" />
          {{ t('settings.aiConfig.title') }}
        </h3>

        <div class="rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
          <div v-if="loading" class="flex items-center justify-center py-10">
            <UIcon name="i-heroicons-arrow-path" class="h-5 w-5 animate-spin text-gray-400" />
          </div>

          <template v-else-if="config">
            <div class="flex items-center justify-between gap-4 px-4 py-3">
              <div class="flex min-w-0 items-center gap-3">
                <div
                  class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
                >
                  <UIcon name="i-heroicons-sparkles" class="h-4 w-4" />
                </div>
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-gray-900 dark:text-white">
                    {{ config.provider === 'deepseek' ? 'DeepSeek' : t('webAI.config.openAICompatible') }}
                  </p>
                  <p class="truncate text-xs text-gray-500 dark:text-gray-400">
                    {{ config.model }} · {{ config.baseURL }}
                  </p>
                </div>
              </div>
              <div class="flex items-center gap-1">
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-heroicons-pencil-square"
                  :aria-label="t('common.edit')"
                  @click="setupOpen = true"
                />
                <UButton
                  size="xs"
                  color="error"
                  variant="ghost"
                  icon="i-heroicons-trash"
                  :aria-label="t('common.delete')"
                  :loading="removing"
                  @click="removeConfig"
                />
              </div>
            </div>
          </template>

          <div v-else class="flex flex-col items-center justify-center py-8 text-center">
            <UIcon name="i-heroicons-sparkles" class="h-8 w-8 text-gray-300 dark:text-gray-600" />
            <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">{{ t('settings.aiConfig.empty.title') }}</p>
            <p class="text-xs text-gray-400 dark:text-gray-500">{{ t('settings.aiConfig.empty.description') }}</p>
          </div>

          <div v-if="!config && !loading" class="border-t border-gray-200 px-4 py-3 dark:border-gray-700">
            <UButton variant="soft" size="sm" @click="setupOpen = true">
              <UIcon name="i-heroicons-plus" class="mr-1.5 h-3.5 w-3.5" />
              {{ t('settings.aiConfig.addConfig') }}
            </UButton>
          </div>
        </div>
      </div>

      <div
        class="rounded-lg bg-gray-50 px-4 py-3 text-xs leading-5 text-gray-500 dark:bg-gray-800/50 dark:text-gray-400"
      >
        <p>{{ t('webAI.config.description') }}</p>
        <p class="mt-1">{{ t('webAI.config.keyStorageWarning') }}</p>
        <p class="mt-1">{{ t('webAI.config.corsWarning') }}</p>
      </div>
    </div>

    <WebAIModelSetupModal
      ref="setupModal"
      v-model:open="setupOpen"
      :config="config"
      :testing="testing"
      :saving="saving"
      :removing="removing"
      @test="testConnection"
      @save="saveConfig"
      @remove="removeConfig"
    />
  </div>
</template>
