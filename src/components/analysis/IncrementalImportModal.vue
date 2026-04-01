<script setup lang="ts">
/**
 * 增量导入弹窗
 * 支持向已有会话追加聊天记录（去重后合并）
 */

import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FileDropZone } from '@/components/UI'
import type { ImportProgress } from '@/types/base'

const props = defineProps<{
  modelValue: boolean
  sessionId: string
  sessionName: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** 导入完成后触发，携带新增消息数 */
  imported: [newMessageCount: number]
}>()

const { t } = useI18n()

// 状态
type Stage = 'select' | 'analyzing' | 'preview' | 'importing' | 'done' | 'error'
const stage = ref<Stage>('select')

// 文件信息
const selectedFile = ref<{ path: string; name: string } | null>(null)

// 分析结果
const analyzeResult = ref<{
  newMessageCount: number
  duplicateCount: number
  totalInFile: number
} | null>(null)

// 导入进度
const importProgress = ref<ImportProgress | null>(null)

// 错误信息
const errorMessage = ref<string | null>(null)

// 导入结果
const importResult = ref<{ newMessageCount: number } | null>(null)

// 计算弹窗是否打开
const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

// 监听弹窗关闭，重置状态
watch(isOpen, (value) => {
  if (!value) {
    resetState()
  }
})

// 重置状态
function resetState() {
  stage.value = 'select'
  selectedFile.value = null
  analyzeResult.value = null
  importProgress.value = null
  errorMessage.value = null
  importResult.value = null
}

// 处理文件拖拽/选择
async function handleFileDrop({ paths }: { files: File[]; paths: string[] }) {
  if (paths.length === 0) {
    errorMessage.value = t('home.import.cannotReadPath')
    return
  }

  selectedFile.value = {
    path: paths[0],
    name: paths[0].split('/').pop() || paths[0].split('\\').pop() || paths[0],
  }

  await analyzeFile()
}

// 点击选择文件
async function handleSelectFile() {
  const result = await window.api.dialog.showOpenDialog({
    title: t('analysis.incremental.selectFile'),
    properties: ['openFile'],
    filters: [
      { name: t('home.import.chatRecords'), extensions: ['json', 'jsonl', 'txt'] },
      { name: t('home.import.allFiles'), extensions: ['*'] },
    ],
  })

  if (result.canceled || result.filePaths.length === 0) {
    return
  }

  selectedFile.value = {
    path: result.filePaths[0],
    name: result.filePaths[0].split('/').pop() || result.filePaths[0].split('\\').pop() || result.filePaths[0],
  }

  await analyzeFile()
}

// 分析文件（检测去重后能新增多少消息）
async function analyzeFile() {
  if (!selectedFile.value) return

  stage.value = 'analyzing'
  errorMessage.value = null

  try {
    const result = await window.chatApi.analyzeIncrementalImport(props.sessionId, selectedFile.value.path)

    if (result.error) {
      stage.value = 'error'
      errorMessage.value = translateError(result.error)
      return
    }

    analyzeResult.value = {
      newMessageCount: result.newMessageCount,
      duplicateCount: result.duplicateCount,
      totalInFile: result.totalInFile,
    }

    stage.value = 'preview'
  } catch (error) {
    stage.value = 'error'
    errorMessage.value = String(error)
  }
}

// 执行增量导入
async function executeImport() {
  if (!selectedFile.value) return

  stage.value = 'importing'
  importProgress.value = {
    stage: 'saving',
    progress: 0,
    message: '',
  }

  try {
    // 监听进度
    const unsubscribe = window.chatApi.onImportProgress((progress) => {
      importProgress.value = progress
    })

    const result = await window.chatApi.incrementalImport(props.sessionId, selectedFile.value.path)
    unsubscribe()

    if (result.success) {
      importResult.value = { newMessageCount: result.newMessageCount }
      stage.value = 'done'
    } else {
      stage.value = 'error'
      errorMessage.value = translateError(result.error || 'error.import_failed')
    }
  } catch (error) {
    stage.value = 'error'
    errorMessage.value = String(error)
  }
}

// 完成并关闭
function handleDone() {
  if (importResult.value) {
    emit('imported', importResult.value.newMessageCount)
  }
  isOpen.value = false
}

// 返回选择文件
function handleBack() {
  stage.value = 'select'
  selectedFile.value = null
  analyzeResult.value = null
  errorMessage.value = null
}

// 翻译错误
function translateError(error: string): string {
  if (error.startsWith('error.')) {
    const key = `home.import.errors.${error.slice(6)}`
    const translated = t(key)
    return translated !== key ? translated : error
  }
  return error
}
</script>

<template>
  <UModal v-model:open="isOpen" :title="t('analysis.incremental.title')">
    <template #body>
      <div class="min-h-[200px]">
        <!-- 阶段 1：选择文件 -->
        <div v-if="stage === 'select'" class="space-y-4">
          <p class="text-sm text-gray-600 dark:text-gray-400">
            {{ t('analysis.incremental.description', { name: sessionName }) }}
          </p>

          <FileDropZone :accept="['.json', '.jsonl', '.txt']" class="w-full" @files="handleFileDrop">
            <template #default="{ isDragOver }">
              <div
                class="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 transition-colors"
                :class="
                  isDragOver
                    ? 'border-pink-500 bg-pink-50/50 dark:border-pink-400 dark:bg-pink-500/10'
                    : 'border-gray-300 hover:border-pink-400 dark:border-gray-600 dark:hover:border-pink-500'
                "
                @click="handleSelectFile"
              >
                <UIcon name="i-heroicons-arrow-up-tray" class="mb-3 h-10 w-10 text-gray-400" />
                <p class="text-sm text-gray-600 dark:text-gray-400">
                  {{ isDragOver ? t('home.import.dropHint') : t('analysis.incremental.dropHint') }}
                </p>
              </div>
            </template>
          </FileDropZone>
        </div>

        <!-- 阶段 2：分析中 -->
        <div v-else-if="stage === 'analyzing'" class="flex flex-col items-center justify-center py-10">
          <UIcon name="i-heroicons-arrow-path" class="mb-4 h-10 w-10 animate-spin text-pink-500" />
          <p class="text-gray-600 dark:text-gray-400">{{ t('analysis.incremental.analyzing') }}</p>
          <p class="mt-2 text-sm text-gray-500">{{ selectedFile?.name }}</p>
        </div>

        <!-- 阶段 3：预览 -->
        <div v-else-if="stage === 'preview' && analyzeResult" class="space-y-6">
          <div class="rounded-lg bg-gray-50 p-4 dark:bg-gray-800">
            <p class="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ selectedFile?.name }}
            </p>
            <div class="grid grid-cols-3 gap-4 text-center">
              <div>
                <p class="text-2xl font-bold text-gray-900 dark:text-white">
                  {{ analyzeResult.totalInFile.toLocaleString() }}
                </p>
                <p class="text-xs text-gray-500">{{ t('analysis.incremental.totalInFile') }}</p>
              </div>
              <div>
                <p class="text-2xl font-bold text-green-600 dark:text-green-400">
                  {{ analyzeResult.newMessageCount.toLocaleString() }}
                </p>
                <p class="text-xs text-gray-500">{{ t('analysis.incremental.newMessages') }}</p>
              </div>
              <div>
                <p class="text-2xl font-bold text-gray-400">
                  {{ analyzeResult.duplicateCount.toLocaleString() }}
                </p>
                <p class="text-xs text-gray-500">{{ t('analysis.incremental.duplicates') }}</p>
              </div>
            </div>
          </div>

          <p v-if="analyzeResult.newMessageCount === 0" class="text-center text-sm text-amber-600 dark:text-amber-400">
            <UIcon name="i-heroicons-exclamation-triangle" class="mr-1 inline-block h-4 w-4" />
            {{ t('analysis.incremental.noNewMessages') }}
          </p>
        </div>

        <!-- 阶段 4：导入中 -->
        <div v-else-if="stage === 'importing'" class="flex flex-col items-center justify-center py-10">
          <UIcon name="i-heroicons-arrow-path" class="mb-4 h-10 w-10 animate-spin text-pink-500" />
          <p class="text-gray-600 dark:text-gray-400">{{ t('analysis.incremental.importing') }}</p>
          <div v-if="importProgress" class="mt-4 w-full max-w-xs">
            <UProgress :value="importProgress.progress" size="sm" />
          </div>
        </div>

        <!-- 阶段 5：完成 -->
        <div v-else-if="stage === 'done' && importResult" class="flex flex-col items-center justify-center py-10">
          <UIcon name="i-heroicons-check-circle" class="mb-4 h-12 w-12 text-green-500" />
          <p class="text-lg font-medium text-gray-900 dark:text-white">
            {{ t('analysis.incremental.success') }}
          </p>
          <p class="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {{ t('analysis.incremental.successDetail', { count: importResult.newMessageCount }) }}
          </p>
        </div>

        <!-- 阶段 6：错误 -->
        <div v-else-if="stage === 'error'" class="flex flex-col items-center justify-center py-10">
          <UIcon name="i-heroicons-x-circle" class="mb-4 h-12 w-12 text-red-500" />
          <p class="text-lg font-medium text-gray-900 dark:text-white">
            {{ t('analysis.incremental.failed') }}
          </p>
          <p class="mt-2 text-sm text-red-600 dark:text-red-400">
            {{ errorMessage }}
          </p>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <!-- 选择阶段 -->
        <template v-if="stage === 'select'">
          <UButton color="neutral" variant="ghost" @click="isOpen = false">
            {{ t('common.cancel') }}
          </UButton>
        </template>

        <!-- 预览阶段 -->
        <template v-else-if="stage === 'preview'">
          <UButton color="neutral" variant="ghost" @click="handleBack">
            {{ t('common.back') }}
          </UButton>
          <UButton
            color="primary"
            :disabled="!analyzeResult || analyzeResult.newMessageCount === 0"
            @click="executeImport"
          >
            {{ t('analysis.incremental.import', { count: analyzeResult?.newMessageCount || 0 }) }}
          </UButton>
        </template>

        <!-- 完成/错误阶段 -->
        <template v-else-if="stage === 'done' || stage === 'error'">
          <UButton v-if="stage === 'error'" color="neutral" variant="ghost" @click="handleBack">
            {{ t('common.retry') }}
          </UButton>
          <UButton color="primary" @click="handleDone">
            {{ t('common.done') }}
          </UButton>
        </template>
      </div>
    </template>
  </UModal>
</template>
