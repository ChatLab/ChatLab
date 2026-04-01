<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useToast } from '@nuxt/ui/runtime/composables/useToast.js'
import MarkdownIt from 'markdown-it'
import dayjs from 'dayjs'
import type { SQLResult } from './types'
import { COLUMN_LABELS } from './types'
import { usePromptStore } from '@/stores/prompt'
import { useLayoutStore } from '@/stores/layout'
import { exportSQLResult, type SQLExportFormat } from '@/utils/sqlExport'

const { t, locale } = useI18n()
const toast = useToast()
const promptStore = usePromptStore()
const layoutStore = useLayoutStore()
const { aiGlobalSettings } = storeToRefs(promptStore)

// 时间戳列名匹配模式
const TIMESTAMP_COLUMN_PATTERNS = [
  /^ts$/i,
  /^timestamp$/i,
  /^time$/i,
  /_at$/i, // created_at, updated_at 等
  /_ts$/i,
  /_time$/i,
  /^date$/i,
]

/**
 * 判断列名是否可能是时间戳
 */
function isTimestampColumn(columnName: string): boolean {
  return TIMESTAMP_COLUMN_PATTERNS.some((pattern) => pattern.test(columnName))
}

/**
 * 判断值是否是合理的时间戳（2000年~2100年）
 */
function isValidTimestamp(value: unknown): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false

  // 秒级时间戳范围：946684800 (2000-01-01) ~ 4102444800 (2100-01-01)
  // 毫秒级时间戳范围：946684800000 ~ 4102444800000
  const MIN_SECONDS = 946684800
  const MAX_SECONDS = 4102444800
  const MIN_MILLIS = MIN_SECONDS * 1000
  const MAX_MILLIS = MAX_SECONDS * 1000

  return (value >= MIN_SECONDS && value <= MAX_SECONDS) || (value >= MIN_MILLIS && value <= MAX_MILLIS)
}

/**
 * 将时间戳转换为可读时间
 */
function formatTimestamp(value: number): string {
  // 判断是毫秒级还是秒级
  const isMillis = value > 10000000000
  const ts = isMillis ? value : value * 1000
  return dayjs(ts).format('YYYY-MM-DD HH:mm:ss')
}

// 消息 ID 列名匹配模式
const MESSAGE_ID_COLUMN_PATTERNS = [/^id$/i, /^message_id$/i, /^msg_id$/i, /^msgid$/i]

/**
 * 检测结果中是否有消息 ID 列，返回列索引
 */
function getMessageIdColumnIndex(columns: string[]): number {
  return columns.findIndex((col) => MESSAGE_ID_COLUMN_PATTERNS.some((pattern) => pattern.test(col)))
}

/**
 * 查看消息上下文
 */
function viewMessageContext(messageId: number) {
  layoutStore.openChatRecordDrawer({
    scrollToMessageId: messageId,
  })
}

// 创建 markdown-it 实例
const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typographer: true,
})

// Props
const props = defineProps<{
  result: SQLResult | null
  error: string | null
  sql?: string // 当前 SQL 语句
  prompt?: string // 用户提示词（AI 生成时）
}>()

// 表格排序
const sortColumn = ref<string | null>(null)
const sortDirection = ref<'asc' | 'desc'>('asc')

// 分页相关
const currentPage = ref(1)
const pageSize = ref(100) // 每页显示行数
const pageSizeOptions = [50, 100, 200, 500]

// 时间戳转可读时间（从 localStorage 读取，默认开启）
const showReadableTime = ref(localStorage.getItem('sql-lab-readable-time') !== 'false')

// 监听并持久化时间戳显示设置
function toggleReadableTime() {
  showReadableTime.value = !showReadableTime.value
  localStorage.setItem('sql-lab-readable-time', String(showReadableTime.value))
}

// AI 总结相关状态
const showSummaryModal = ref(false)
const isSummarizing = ref(false)
const summaryContent = ref('')
const summaryError = ref<string | null>(null)
const streamingContent = ref('')

// 导出相关状态
const isExporting = ref(false)

// 获取列的标签（尝试匹配所有表的列）
function getColumnLabelLocal(columnName: string): string | null {
  // 处理带表名前缀的情况，如 "message.sender_id" 或 "m.sender_id"
  const parts = columnName.split('.')
  const colName = parts.length > 1 ? parts[parts.length - 1] : columnName

  // 获取当前语言的标签
  const localeLabels = COLUMN_LABELS[locale.value as 'zh-CN' | 'en-US'] || COLUMN_LABELS['zh-CN']

  // 遍历所有表查找匹配
  for (const tableColumns of Object.values(localeLabels)) {
    if (tableColumns[colName]) {
      return tableColumns[colName]
    }
  }
  return null
}

// 排序后的所有行数据
const allSortedRows = computed(() => {
  if (!props.result || !sortColumn.value) {
    return props.result?.rows || []
  }

  const columnIndex = props.result.columns.indexOf(sortColumn.value)
  if (columnIndex === -1) return props.result.rows

  return [...props.result.rows].sort((a, b) => {
    const aVal = a[columnIndex]
    const bVal = b[columnIndex]

    if (aVal === null) return 1
    if (bVal === null) return -1

    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return sortDirection.value === 'asc' ? aVal - bVal : bVal - aVal
    }

    const comparison = String(aVal).localeCompare(String(bVal))
    return sortDirection.value === 'asc' ? comparison : -comparison
  })
})

// 总页数
const totalPages = computed(() => {
  if (!props.result) return 0
  return Math.ceil(allSortedRows.value.length / pageSize.value)
})

// 当前页的数据
const sortedRows = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  const end = start + pageSize.value
  return allSortedRows.value.slice(start, end)
})

// 消息 ID 列索引（-1 表示没有）
const messageIdColumnIndex = computed(() => {
  if (!props.result) return -1
  return getMessageIdColumnIndex(props.result.columns)
})

// 是否显示查看消息按钮
const showViewMessageButton = computed(() => messageIdColumnIndex.value !== -1)

// 处理列排序
function handleSort(column: string) {
  if (sortColumn.value === column) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortColumn.value = column
    sortDirection.value = 'asc'
  }
  // 排序后回到第一页
  currentPage.value = 1
}

// 处理每页显示数量变化
function handlePageSizeChange(size: number) {
  pageSize.value = size
  currentPage.value = 1
}

// 格式化单元格值
function formatCellValue(value: any, columnName?: string): string {
  if (value === null) return 'NULL'
  if (typeof value === 'object') return JSON.stringify(value)

  // 时间戳转换（仅在开启且是时间戳列时）
  if (showReadableTime.value && columnName && isTimestampColumn(columnName) && isValidTimestamp(value)) {
    return formatTimestamp(value)
  }

  return String(value)
}

// 导出结果到文件（导出所有数据，不受分页限制）
async function exportResult() {
  if (!props.result || isExporting.value) return

  isExporting.value = true
  try {
    const format = (aiGlobalSettings.value.sqlExportFormat ?? 'csv') as SQLExportFormat
    const result = await exportSQLResult(
      {
        columns: props.result.columns,
        rows: props.result.rows, // 导出所有数据
      },
      format
    )

    if (result.success && result.filePath) {
      const filename = result.filePath.split('/').pop() || result.filePath
      toast.add({
        title: t('common.exportSuccess'),
        description: filename,
        icon: 'i-heroicons-check-circle',
        color: 'primary',
        duration: 3000,
        actions: [
          {
            label: t('common.openFolder'),
            onClick: () => {
              window.cacheApi.showInFolder(result.filePath!)
            },
          },
        ],
      })
    } else {
      toast.add({
        title: t('common.exportFailed'),
        description: result.error,
        icon: 'i-heroicons-x-circle',
        color: 'error',
        duration: 3000,
      })
    }
  } catch (err) {
    console.error('导出失败:', err)
    toast.add({
      title: t('common.exportFailed'),
      description: String(err),
      icon: 'i-heroicons-x-circle',
      color: 'error',
      duration: 3000,
    })
  } finally {
    isExporting.value = false
  }
}

// 重置排序和分页状态（供父组件调用）
function resetSort() {
  sortColumn.value = null
  sortDirection.value = 'asc'
  currentPage.value = 1
}

// ==================== AI 总结功能 ====================

// 构建总结结果的数据（取前 50 行避免 token 过多）
function buildResultSummary(): string {
  if (!props.result) return ''

  const maxRows = 50
  const rows = props.result.rows.slice(0, maxRows)

  // 构建表格形式的结果
  const header = props.result.columns.join(' | ')
  const separator = props.result.columns.map(() => '---').join(' | ')
  const dataRows = rows.map((row) =>
    row.map((cell) => (cell === null ? 'NULL' : String(cell).slice(0, 50))).join(' | ')
  )

  let resultText = `| ${header} |\n| ${separator} |\n`
  resultText += dataRows.map((r) => `| ${r} |`).join('\n')

  if (props.result.rows.length > maxRows) {
    resultText += `\n\n（仅展示前 ${maxRows} 行，共 ${props.result.rowCount} 行）`
  }

  return resultText
}

// 打开总结弹窗并开始总结
async function openSummaryModal() {
  showSummaryModal.value = true
  summaryContent.value = ''
  summaryError.value = null
  streamingContent.value = ''
  await generateSummary()
}

// AI 总结
async function generateSummary() {
  const hasConfig = await window.llmApi.hasConfig()
  if (!hasConfig) {
    summaryError.value = t('common.errorNoAIConfig')
    return
  }

  isSummarizing.value = true
  summaryError.value = null
  streamingContent.value = ''

  try {
    const resultSummary = buildResultSummary()

    let contextInfo = ''
    if (props.prompt) {
      contextInfo = `用户的查询意图：${props.prompt}\n\n`
    }
    if (props.sql) {
      contextInfo += `执行的 SQL 语句：\n\`\`\`sql\n${props.sql}\n\`\`\`\n\n`
    }

    const prompt = `请分析以下 SQL 查询结果，用简洁的中文总结关键发现和洞察。

${contextInfo}查询结果（共 ${props.result?.rowCount || 0} 行）：

${resultSummary}

请提供：
1. 结果概述（一句话总结）
2. 关键发现（2-4 个要点）
3. 如有明显的趋势或异常，请指出`

    const result = await window.llmApi.chatStream(
      [
        {
          role: 'system',
          content: '你是一个数据分析专家，擅长从查询结果中提取关键信息和洞察。请用简洁清晰的中文回答。',
        },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.3, maxTokens: 1000 },
      (chunk) => {
        if (chunk.content) {
          streamingContent.value += chunk.content
        }
      }
    )

    if (result.success) {
      summaryContent.value = streamingContent.value
    } else {
      summaryError.value = result.error || t('ai.sqlLab.result.errorSummary')
    }
  } catch (err: any) {
    summaryError.value = err.message || String(err)
  } finally {
    isSummarizing.value = false
  }
}

// 关闭总结弹窗
function closeSummaryModal() {
  showSummaryModal.value = false
  summaryContent.value = ''
  summaryError.value = null
  streamingContent.value = ''
}

defineExpose({ resetSort })
</script>

<template>
  <div class="flex flex-1 flex-col overflow-hidden">
    <!-- 错误提示 -->
    <div v-if="error" class="border-b border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
      <div class="flex items-start gap-2">
        <UIcon name="i-heroicons-exclamation-circle" class="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-red-800 dark:text-red-200">{{ t('ai.sqlLab.result.queryError') }}</p>
          <p class="mt-1 break-all font-mono text-xs text-red-600 dark:text-red-400">{{ error }}</p>
        </div>
      </div>
    </div>

    <!-- 结果统计栏 -->
    <div
      v-if="result"
      class="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-800 dark:bg-gray-900"
    >
      <div class="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
        <!-- 时间戳转日期开关 -->
        <label class="flex cursor-pointer items-center gap-1.5">
          <UCheckbox :model-value="showReadableTime" size="xs" @update:model-value="toggleReadableTime" />
          <span class="text-xs">{{ t('ai.sqlLab.result.readableTime') }}</span>
        </label>
        <span class="text-gray-300 dark:text-gray-600">|</span>
        <span>
          <UIcon name="i-heroicons-table-cells" class="mr-1 inline h-4 w-4" />
          {{ t('ai.sqlLab.result.rows', { count: result.rowCount }) }}
        </span>
        <span>
          <UIcon name="i-heroicons-clock" class="mr-1 inline h-4 w-4" />
          {{ result.duration }} ms
        </span>
      </div>
      <div class="flex items-center gap-2">
        <UButton variant="ghost" size="xs" @click="openSummaryModal">
          <UIcon name="i-heroicons-sparkles" class="mr-1 h-4 w-4" />
          {{ t('ai.sqlLab.result.summarize') }}
        </UButton>
        <UButton variant="ghost" size="xs" :loading="isExporting" @click="exportResult">
          <UIcon name="i-heroicons-arrow-down-tray" class="mr-1 h-4 w-4" />
          {{ t('common.export') }}
        </UButton>
      </div>
    </div>

    <!-- 结果表格 -->
    <div v-if="result && result.rows.length > 0" class="flex-1 overflow-auto">
      <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead class="sticky top-0 bg-gray-100 dark:bg-gray-800">
          <tr>
            <th
              v-for="(column, index) in result.columns"
              :key="index"
              class="cursor-pointer whitespace-nowrap px-4 py-2 text-left text-xs font-medium transition-colors hover:bg-gray-200 dark:hover:bg-gray-700"
              @click="handleSort(column)"
            >
              <div class="flex items-center gap-1">
                <div class="flex flex-col">
                  <span class="text-gray-700 dark:text-gray-300">{{ getColumnLabelLocal(column) || column }}</span>
                  <span v-if="getColumnLabelLocal(column)" class="font-mono text-[10px] text-gray-400">
                    {{ column }}
                  </span>
                </div>
                <UIcon
                  v-if="sortColumn === column"
                  :name="sortDirection === 'asc' ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'"
                  class="h-3 w-3 text-gray-500"
                />
              </div>
            </th>
            <!-- 操作列（当有消息 ID 时显示） -->
            <th v-if="showViewMessageButton" class="sticky right-0 w-12 bg-gray-100 px-2 py-2 dark:bg-gray-800"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
          <tr v-for="(row, rowIndex) in sortedRows" :key="rowIndex" class="hover:bg-gray-50 dark:hover:bg-gray-800">
            <td
              v-for="(cell, cellIndex) in row"
              :key="cellIndex"
              class="max-w-xs truncate whitespace-nowrap px-4 py-2 font-mono text-sm text-gray-700 dark:text-gray-300"
              :class="{ 'text-gray-400 italic': cell === null }"
              :title="formatCellValue(cell, result.columns[cellIndex])"
            >
              {{ formatCellValue(cell, result.columns[cellIndex]) }}
            </td>
            <!-- 查看消息按钮 -->
            <td v-if="showViewMessageButton" class="sticky right-0 w-12 bg-white px-2 py-2 dark:bg-gray-900">
              <UButton
                icon="i-heroicons-chat-bubble-left-right"
                color="neutral"
                variant="ghost"
                size="xs"
                :title="t('ai.sqlLab.result.viewChat')"
                @click="viewMessageContext(row[messageIdColumnIndex] as number)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 分页栏 -->
    <div
      v-if="result && result.rows.length > 0 && totalPages > 1"
      class="flex shrink-0 items-center gap-4 border-t border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-800 dark:bg-gray-900"
    >
      <!-- 翻页按钮 -->
      <div class="flex items-center gap-1">
        <UButton
          icon="i-heroicons-chevron-double-left"
          variant="ghost"
          size="xs"
          :disabled="currentPage === 1"
          @click="currentPage = 1"
        />
        <UButton
          icon="i-heroicons-chevron-left"
          variant="ghost"
          size="xs"
          :disabled="currentPage === 1"
          @click="currentPage--"
        />
        <span class="mx-2 text-xs text-gray-600 dark:text-gray-400">{{ currentPage }} / {{ totalPages }}</span>
        <UButton
          icon="i-heroicons-chevron-right"
          variant="ghost"
          size="xs"
          :disabled="currentPage >= totalPages"
          @click="currentPage++"
        />
        <UButton
          icon="i-heroicons-chevron-double-right"
          variant="ghost"
          size="xs"
          :disabled="currentPage >= totalPages"
          @click="currentPage = totalPages"
        />
      </div>
      <!-- 每页数量选择 -->
      <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span>{{ t('ai.sqlLab.result.pageSize') }}</span>
        <USelect
          :model-value="pageSize"
          :items="pageSizeOptions.map((n) => ({ label: String(n), value: n }))"
          size="xs"
          class="w-20"
          @update:model-value="handlePageSizeChange"
        />
      </div>
    </div>

    <!-- 空结果 -->
    <div
      v-if="result && result.rows.length === 0"
      class="flex flex-1 items-center justify-center text-gray-500 dark:text-gray-400"
    >
      <div class="text-center">
        <UIcon name="i-heroicons-inbox" class="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600" />
        <p class="mt-2 text-sm">{{ t('ai.sqlLab.result.emptyResult') }}</p>
      </div>
    </div>

    <!-- 初始状态 -->
    <div v-if="!result && !error" class="flex flex-1 items-center justify-center text-gray-500 dark:text-gray-400">
      <div class="text-center">
        <UIcon name="i-heroicons-command-line" class="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600" />
        <p class="mt-2 text-sm">{{ t('ai.sqlLab.result.initialState') }}</p>
        <p class="mt-1 text-xs text-gray-400">{{ t('ai.sqlLab.result.initialHint') }}</p>
      </div>
    </div>

    <!-- AI 总结弹窗 -->
    <UModal v-model:open="showSummaryModal">
      <template #content>
        <div class="max-h-[70vh] overflow-hidden p-6">
          <div class="mb-4 flex items-center gap-2">
            <UIcon name="i-heroicons-sparkles" class="h-5 w-5 text-pink-500" />
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ t('ai.sqlLab.result.summaryTitle') }}
            </h3>
          </div>

          <!-- 加载状态 -->
          <div v-if="isSummarizing && !streamingContent" class="flex items-center justify-center py-8">
            <UIcon name="i-heroicons-arrow-path" class="h-6 w-6 animate-spin text-pink-500" />
            <span class="ml-2 text-sm text-gray-500">{{ t('ai.sqlLab.result.analyzing') }}</span>
          </div>

          <!-- 流式输出 / 最终结果 -->
          <div v-else-if="streamingContent || summaryContent" class="max-h-[50vh] overflow-y-auto">
            <div
              class="prose prose-sm max-w-none rounded-lg bg-gray-50 p-4 dark:prose-invert dark:bg-gray-900"
              v-html="md.render(streamingContent || summaryContent)"
            />
            <div v-if="isSummarizing" class="mt-2 flex items-center text-xs text-gray-400">
              <UIcon name="i-heroicons-arrow-path" class="mr-1 h-3 w-3 animate-spin" />
              {{ t('common.generating') }}
            </div>
          </div>

          <!-- 错误提示 -->
          <div v-if="summaryError" class="rounded-lg bg-red-50 p-4 dark:bg-red-950">
            <p class="text-sm text-red-600 dark:text-red-400">{{ summaryError }}</p>
          </div>

          <!-- 底部按钮 -->
          <div class="mt-4 flex justify-end gap-2">
            <UButton v-if="!isSummarizing && summaryContent" variant="outline" @click="generateSummary">
              <UIcon name="i-heroicons-arrow-path" class="mr-1 h-4 w-4" />
              {{ t('common.regenerate') }}
            </UButton>
            <UButton variant="ghost" @click="closeSummaryModal">{{ t('common.close') }}</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>

<!-- Markdown 样式已提取到全局 src/assets/styles/markdown.css -->
