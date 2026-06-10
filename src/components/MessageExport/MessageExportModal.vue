<script setup lang="ts">
import { ref, computed, watch, toRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'
import { useSessionStore } from '@/stores/session'
import { usePlatformService, useAIService } from '@/services'
import { IS_ELECTRON } from '@/utils/platform'
import type { ExportFormat } from '@/services/ai/types'
import ConditionPanel from './ConditionPanel.vue'

const STORAGE_KEY = 'chatlab-export-format'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const { t } = useI18n()
const toast = useToast()
const sessionStore = useSessionStore()

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const timeRange = ref<{ start: number; end: number } | null>(null)
const exportFormat = ref<ExportFormat>((localStorage.getItem(STORAGE_KEY) as ExportFormat) || 'txt')
watch(exportFormat, (v) => localStorage.setItem(STORAGE_KEY, v))

const isExporting = ref(false)
const exportProgress = ref<{ percentage: number; message: string } | null>(null)
let unsubscribeExportProgress: (() => void) | null = null

function startExportProgressListener() {
  unsubscribeExportProgress = useAIService().onExportProgress((progress) => {
    exportProgress.value = { percentage: progress.percentage, message: progress.message }
    if (progress.stage === 'done' || progress.stage === 'error') {
      exportProgress.value = null
    }
  })
}

function stopExportProgressListener() {
  if (unsubscribeExportProgress) {
    unsubscribeExportProgress()
    unsubscribeExportProgress = null
  }
  exportProgress.value = null
}

async function handleExport() {
  const sessionId = sessionStore.currentSessionId
  if (!sessionId) return

  const sessionInfo = sessionStore.currentSession
  const sessionName = sessionInfo?.name || 'unknown'

  let outputDir = ''
  if (IS_ELECTRON) {
    const dialogResult = await usePlatformService().showOpenDialog({
      title: t('analysis.messageExport.selectOutputDir'),
      properties: ['openDirectory', 'createDirectory'],
    })
    if (dialogResult.canceled || !dialogResult.filePaths[0]) return
    outputDir = dialogResult.filePaths[0]
  }

  isExporting.value = true
  exportProgress.value = { percentage: 0, message: t('analysis.filter.exportPreparing') }
  startExportProgressListener()

  try {
    const raw = toRaw(timeRange.value)
    const result = await useAIService().exportFilterResultToFile({
      sessionId,
      sessionName,
      outputDir,
      format: exportFormat.value,
      timeFilter: raw ? { startTs: raw.start, endTs: raw.end } : undefined,
    })

    if (result.success) {
      toast.success(t('analysis.filter.exportSuccess'), { description: result.filePath })
      isOpen.value = false
    } else {
      toast.fail(t('analysis.filter.exportFailed'), {
        description: result.error || t('common.error.unknown'),
      })
    }
  } catch (error) {
    console.error('Export failed:', error)
    toast.fail(t('analysis.filter.exportFailed'), { description: String(error) })
  } finally {
    stopExportProgressListener()
    isExporting.value = false
  }
}

watch(isOpen, (value) => {
  if (!value) stopExportProgressListener()
})
</script>

<template>
  <UModal v-model:open="isOpen" :ui="{ content: 'sm:max-w-md' }">
    <template #content>
      <div class="flex flex-col overflow-hidden bg-white dark:bg-gray-900">
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
            {{ t('analysis.messageExport.title') }}
          </h2>
          <UButton variant="ghost" icon="i-heroicons-x-mark" size="sm" @click="isOpen = false" />
        </div>

        <!-- Filters -->
        <ConditionPanel v-model:time-range="timeRange" v-model:export-format="exportFormat" />

        <!-- Footer -->
        <div class="flex flex-col gap-3 border-t border-gray-200 px-5 py-4 dark:border-gray-700">
          <!-- Export Progress -->
          <div v-if="isExporting && exportProgress" class="w-full">
            <div class="mb-1 flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
              <span>{{ exportProgress.message }}</span>
              <span>{{ exportProgress.percentage }}%</span>
            </div>
            <div class="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
              <div
                class="h-full bg-primary-500 transition-all duration-300"
                :style="{ width: `${exportProgress.percentage}%` }"
              />
            </div>
          </div>

          <div class="flex items-center justify-end gap-3">
            <UButton variant="ghost" @click="isOpen = false">
              {{ t('common.cancel') }}
            </UButton>
            <UButton
              color="primary"
              icon="i-heroicons-document-arrow-down"
              :loading="isExporting"
              :disabled="isExporting"
              @click="handleExport"
            >
              {{ t('common.export') }}
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
