<script setup lang="ts">
/**
 * 导出聊天记录弹窗
 * 支持两种互斥的筛选模式：
 * 1. 条件筛选：按关键词、时间、发送者筛选，并自动扩展上下文
 * 2. 会话筛选：直接选择已有的会话（对话段落）
 *
 * 筛选后可导出为 Markdown 文件，支持分页加载和大数据量
 */

import { ref, computed, watch, toRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@nuxt/ui/runtime/composables/useToast.js'
import { useSessionStore } from '@/stores/session'
import ConditionPanel from './ConditionPanel.vue'
import SessionPanel from './SessionPanel.vue'
import PreviewPanel from './PreviewPanel.vue'
import FilterHistory from './FilterHistory.vue'

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

// 筛选模式：'condition' | 'session'
const filterMode = ref<'condition' | 'session'>('condition')

// 条件筛选参数
const conditionFilter = ref<{
  keywords: string[]
  timeRange: { start: number; end: number } | null
  senderIds: number[]
  contextSize: number
}>({
  keywords: [],
  timeRange: null,
  senderIds: [],
  contextSize: 10,
})

// 会话筛选参数
const selectedSessionIds = ref<number[]>([])

// 筛选结果消息类型
interface FilterMessage {
  id: number
  senderName: string
  senderPlatformId: string
  senderAliases: string[]
  senderAvatar: string | null
  content: string
  timestamp: number
  type: number
  replyToMessageId: string | null
  replyToContent: string | null
  replyToSenderName: string | null
  isHit: boolean
}

// 分页信息类型
interface PaginationInfo {
  page: number
  pageSize: number
  totalBlocks: number
  totalHits: number
  hasMore: boolean
}

// 筛选结果（带分页）
const filterResult = ref<{
  blocks: Array<{
    startTs: number
    endTs: number
    messages: FilterMessage[]
    hitCount: number
  }>
  stats: {
    totalMessages: number
    hitMessages: number
    totalChars: number
  }
  pagination: PaginationInfo
} | null>(null)

// 加载状态
const isFiltering = ref(false)
const isLoadingMore = ref(false)
const showHistory = ref(false)

// 每页块数
const PAGE_SIZE = 50

// 是否可以执行筛选
const canExecuteFilter = computed(() => {
  if (isFiltering.value) return false

  if (filterMode.value === 'condition') {
    return (
      conditionFilter.value.keywords.length > 0 ||
      conditionFilter.value.senderIds.length > 0 ||
      conditionFilter.value.timeRange !== null
    )
  } else {
    return selectedSessionIds.value.length > 0
  }
})

// 执行筛选（首次加载）
async function executeFilter() {
  const sessionId = sessionStore.currentSessionId
  if (!sessionId) return

  isFiltering.value = true
  filterResult.value = null

  try {
    if (filterMode.value === 'condition') {
      const rawFilter = toRaw(conditionFilter.value)
      const keywords = rawFilter.keywords.length > 0 ? [...rawFilter.keywords] : undefined
      const timeFilter = rawFilter.timeRange
        ? { startTs: rawFilter.timeRange.start, endTs: rawFilter.timeRange.end }
        : undefined
      const senderIds = rawFilter.senderIds.length > 0 ? [...rawFilter.senderIds] : undefined
      const contextSize = rawFilter.contextSize

      const result = await window.aiApi.filterMessagesWithContext(
        sessionId,
        keywords,
        timeFilter,
        senderIds,
        contextSize,
        1,
        PAGE_SIZE
      )
      filterResult.value = result
    } else {
      if (selectedSessionIds.value.length === 0) return
      const sessionIds = [...toRaw(selectedSessionIds.value)]
      const result = await window.aiApi.getMultipleSessionsMessages(sessionId, sessionIds, 1, PAGE_SIZE)
      filterResult.value = result
    }
  } catch (error) {
    console.error('筛选失败:', error)
  } finally {
    isFiltering.value = false
  }
}

// 加载更多块
async function loadMoreBlocks() {
  const sessionId = sessionStore.currentSessionId
  if (!sessionId || !filterResult.value || !filterResult.value.pagination.hasMore || isLoadingMore.value) return

  isLoadingMore.value = true
  const nextPage = filterResult.value.pagination.page + 1

  try {
    let result
    if (filterMode.value === 'condition') {
      const rawFilter = toRaw(conditionFilter.value)
      const keywords = rawFilter.keywords.length > 0 ? [...rawFilter.keywords] : undefined
      const timeFilter = rawFilter.timeRange
        ? { startTs: rawFilter.timeRange.start, endTs: rawFilter.timeRange.end }
        : undefined
      const senderIds = rawFilter.senderIds.length > 0 ? [...rawFilter.senderIds] : undefined
      const contextSize = rawFilter.contextSize

      result = await window.aiApi.filterMessagesWithContext(
        sessionId,
        keywords,
        timeFilter,
        senderIds,
        contextSize,
        nextPage,
        PAGE_SIZE
      )
    } else {
      const sessionIds = [...toRaw(selectedSessionIds.value)]
      result = await window.aiApi.getMultipleSessionsMessages(sessionId, sessionIds, nextPage, PAGE_SIZE)
    }

    if (result && result.blocks.length > 0) {
      filterResult.value = {
        blocks: [...filterResult.value.blocks, ...result.blocks],
        stats: filterResult.value.stats,
        pagination: result.pagination,
      }
    }
  } catch (error) {
    console.error('加载更多失败:', error)
  } finally {
    isLoadingMore.value = false
  }
}

// 导出状态
const isExporting = ref(false)
const exportProgress = ref<{
  percentage: number
  message: string
} | null>(null)

let unsubscribeExportProgress: (() => void) | null = null

function startExportProgressListener() {
  unsubscribeExportProgress = window.aiApi.onExportProgress((progress) => {
    exportProgress.value = {
      percentage: progress.percentage,
      message: progress.message,
    }
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

async function exportFeedPack() {
  if (!filterResult.value || filterResult.value.blocks.length === 0) return

  const sessionId = sessionStore.currentSessionId
  if (!sessionId) return

  const sessionInfo = sessionStore.currentSession
  const sessionName = sessionInfo?.name || '未知会话'

  const dialogResult = await window.api.dialog.showOpenDialog({
    title: '选择保存目录',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (dialogResult.canceled || !dialogResult.filePaths[0]) return
  const outputDir = dialogResult.filePaths[0]

  isExporting.value = true
  exportProgress.value = { percentage: 0, message: t('analysis.filter.exportPreparing') }

  startExportProgressListener()

  try {
    const rawFilter = toRaw(conditionFilter.value)
    const exportParams = {
      sessionId,
      sessionName,
      outputDir,
      filterMode: filterMode.value,
      keywords: rawFilter.keywords.length > 0 ? [...rawFilter.keywords] : undefined,
      timeFilter: rawFilter.timeRange
        ? { startTs: rawFilter.timeRange.start, endTs: rawFilter.timeRange.end }
        : undefined,
      senderIds: rawFilter.senderIds.length > 0 ? [...rawFilter.senderIds] : undefined,
      contextSize: rawFilter.contextSize,
      chatSessionIds: filterMode.value === 'session' ? [...toRaw(selectedSessionIds.value)] : undefined,
    }

    const exportResult = await window.aiApi.exportFilterResultToFile(exportParams)

    if (exportResult.success && exportResult.filePath) {
      toast.add({
        title: t('analysis.filter.exportSuccess'),
        description: exportResult.filePath,
        color: 'green',
        icon: 'i-heroicons-check-circle',
      })
    } else {
      toast.add({
        title: t('analysis.filter.exportFailed'),
        description: exportResult.error || t('common.error.unknown'),
        color: 'red',
        icon: 'i-heroicons-x-circle',
      })
    }
  } catch (error) {
    console.error('导出失败:', error)
    toast.add({
      title: t('analysis.filter.exportFailed'),
      description: String(error),
      color: 'red',
      icon: 'i-heroicons-x-circle',
    })
  } finally {
    stopExportProgressListener()
    isExporting.value = false
  }
}

// 切换模式时清空结果
watch(filterMode, () => {
  filterResult.value = null
})

// 弹窗关闭时重置状态
watch(isOpen, (value) => {
  if (!value) {
    filterResult.value = null
    stopExportProgressListener()
  }
})

// 加载历史筛选条件
function loadHistoryCondition(condition: {
  mode: 'condition' | 'session'
  conditionFilter?: typeof conditionFilter.value
  selectedSessionIds?: number[]
}) {
  filterMode.value = condition.mode
  if (condition.mode === 'condition' && condition.conditionFilter) {
    conditionFilter.value = { ...condition.conditionFilter }
  } else if (condition.mode === 'session' && condition.selectedSessionIds) {
    selectedSessionIds.value = [...condition.selectedSessionIds]
  }
  showHistory.value = false
}
</script>

<template>
  <UModal v-model:open="isOpen" :ui="{ content: 'sm:max-w-[95vw]' }">
    <template #content>
      <div class="flex h-[85vh] flex-col overflow-hidden bg-white dark:bg-gray-900">
        <!-- 顶部工具栏 -->
        <div
          class="flex flex-none items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700"
        >
          <div class="flex items-center gap-4">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ t('analysis.messageExport.title') }}
            </h2>

            <!-- 模式切换 -->
            <div class="flex items-center gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
              <button
                class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
                :class="
                  filterMode === 'condition'
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                    : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                "
                @click="filterMode = 'condition'"
              >
                {{ t('analysis.filter.conditionMode') }}
              </button>
              <button
                class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
                :class="
                  filterMode === 'session'
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                    : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                "
                @click="filterMode = 'session'"
              >
                {{ t('analysis.filter.sessionMode') }}
              </button>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <UButton variant="ghost" icon="i-heroicons-clock" size="sm" @click="showHistory = true">
              {{ t('analysis.filter.history') }}
            </UButton>
            <UButton variant="ghost" icon="i-heroicons-x-mark" size="sm" @click="isOpen = false" />
          </div>
        </div>

        <!-- 主体内容区 -->
        <div class="flex flex-1 overflow-hidden">
          <!-- 左侧筛选面板 -->
          <div class="flex w-80 flex-none flex-col border-r border-gray-200 dark:border-gray-700">
            <div class="min-h-0 flex-1 overflow-y-auto">
              <ConditionPanel
                v-if="filterMode === 'condition'"
                v-model:keywords="conditionFilter.keywords"
                v-model:time-range="conditionFilter.timeRange"
                v-model:sender-ids="conditionFilter.senderIds"
                v-model:context-size="conditionFilter.contextSize"
              />
              <SessionPanel v-else v-model:selected-ids="selectedSessionIds" />
            </div>

            <div class="flex-none border-t border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
              <UButton
                block
                color="primary"
                :loading="isFiltering"
                :disabled="!canExecuteFilter"
                @click="executeFilter"
              >
                {{ t('analysis.filter.execute') }}
              </UButton>
            </div>
          </div>

          <!-- 右侧预览面板 -->
          <div class="flex flex-1 flex-col overflow-hidden">
            <PreviewPanel
              :result="filterResult"
              :is-loading="isFiltering"
              :is-loading-more="isLoadingMore"
              @load-more="loadMoreBlocks"
            />

            <!-- 底部操作按钮 -->
            <div
              v-if="filterResult && filterResult.blocks.length > 0"
              class="flex flex-none flex-col gap-2 border-t border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800"
            >
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
                <UButton
                  variant="outline"
                  icon="i-heroicons-document-arrow-down"
                  :loading="isExporting"
                  :disabled="isExporting"
                  @click="exportFeedPack"
                >
                  {{ t('analysis.filter.export') }}
                </UButton>
              </div>
            </div>
          </div>
        </div>

        <!-- 历史记录弹窗 -->
        <FilterHistory v-model:open="showHistory" @load="loadHistoryCondition" />
      </div>
    </template>
  </UModal>
</template>
