<script setup lang="ts">
import { FileDropZone } from '@/components/UI'
import FileListItem from './FileListItem.vue'
import ChatSelector, { type ChatInfo } from './ChatSelector.vue'
import FormatSelectorModal from './FormatSelectorModal.vue'
import { runPreparedImportBatch } from './preparedImportFlow'
import { storeToRefs } from 'pinia'
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useSessionStore, type BatchFileInfo, type MergeFileInfo } from '@/stores/session'
import {
  useDataService,
  useImportService,
  useSessionIndexService,
  usePlatformService,
  type PreparedImportSource,
} from '@/services'
import { IS_ELECTRON } from '@/utils/platform'
import { useCacheService } from '@/services/cache/service'
import { getSessionGapThreshold } from '@/composables/useUiConfig'

const { t } = useI18n()
const sessionStore = useSessionStore()
const {
  isImporting,
  importProgress,
  isBatchImporting,
  batchFiles,
  batchImportCancelled,
  batchImportResult,
  // 合并导入
  isMergeImporting,
  mergeFiles,
  mergeStage,
  mergeError,
  mergeResult,
} = storeToRefs(sessionStore)

// 聊天选择器状态（多聊天格式通用）
const showChatSelector = ref(false)
const chatSelectorFilePath = ref('')
const chatSelectorChats = ref<ChatInfo[]>([])
const chatSelectorLoading = ref(false)
const chatSelectorError = ref<string | null>(null)
const preparedImportSource = ref<PreparedImportSource | null>(null)

// 格式选择器状态（自动检测失败时的手动兜底）
const showFormatSelector = ref(false)
const formatSelectorFilePath = ref('')

async function autoGenerateSessionIndex(sessionId: string) {
  try {
    const gapThreshold = getSessionGapThreshold()
    await useSessionIndexService().generate(sessionId, gapThreshold)
  } catch (error) {
    console.error('自动生成会话索引失败:', error)
  }
}

const importError = ref<string | null>(null)
const hasImportLog = ref(false)
const importDiagnostics = ref<{
  logFile: string | null
  detectedFormat: string | null
  messagesReceived: number
  messagesWritten: number
  messagesSkipped: number
} | null>(null)

const router = useRouter()

// 更多选项展开状态

// 合并导入开关
const mergeImportEnabled = ref(false)

// 计算是否正在导入（单文件、批量或合并）
const isAnyImporting = computed(() => isImporting.value || isBatchImporting.value || isMergeImporting.value)

// 计算批量导入进度
const batchProgress = computed(() => {
  if (!isBatchImporting.value || batchFiles.value.length === 0) return null

  const completed = batchFiles.value.filter(
    (f) => f.status === 'success' || f.status === 'failed' || f.status === 'cancelled'
  ).length
  const current = batchFiles.value.findIndex((f) => f.status === 'importing')

  return {
    completed,
    total: batchFiles.value.length,
    currentIndex: current,
  }
})

/**
 * Translate error key to localized message
 * Error keys follow format: 'error.{error_name}'
 * Example: 'error.unrecognized_format' -> t('home.import.errors.unrecognized_format')
 */
function translateError(error: string): string {
  if (error.startsWith('error.')) {
    const key = `home.import.errors.${error.slice(6)}` // Remove 'error.' prefix
    const translated = t(key)
    return translated !== key ? translated : error
  }
  // Unknown error format, return as-is
  return error
}

// 根据会话类型导航到对应页面
async function navigateToSession(sessionId: string) {
  const session = await useDataService().getSession(sessionId)
  if (session) {
    const routeName = session.type === 'private' ? 'private-chat' : 'group-chat'
    router.push({ name: routeName, params: { id: sessionId } })
  }
}

// 检查是否有导入日志 - Electron only
async function checkImportLog() {
  if (!IS_ELECTRON) return
  const result = await useCacheService().getLatestImportLog()
  hasImportLog.value = result.success && !!result.path
}

const dropZoneRef = ref<InstanceType<typeof FileDropZone> | null>(null)

function isArchiveFile(file: File | string): boolean {
  const name = typeof file === 'string' ? file : file.name
  return name.toLowerCase().endsWith('.zip')
}

function mapLegacyChat(chat: {
  index: number
  name: string
  type: string
  id: number
  messageCount: number
}): ChatInfo {
  return {
    chatId: `legacy:${chat.index}`,
    index: chat.index,
    id: chat.id,
    name: chat.name,
    type: chat.type,
    messageCount: chat.messageCount,
  }
}

async function prepareArchiveImport(file: File | string) {
  chatSelectorChats.value = []
  chatSelectorError.value = null
  chatSelectorLoading.value = true
  showChatSelector.value = true

  try {
    const result = await useImportService().prepareImportSource(file)
    if (!result.success || !result.source) {
      chatSelectorError.value = translateError(result.error || 'error.archive_unsupported')
      return
    }
    preparedImportSource.value = result.source
    chatSelectorChats.value = result.source.chats.map((chat) => ({
      chatId: chat.chatId,
      name: chat.name,
      type: chat.type,
      messageCount: chat.messageCount,
      memberCount: chat.memberCount,
    }))
  } catch (error) {
    chatSelectorError.value = translateError(error instanceof Error ? error.message : String(error))
  } finally {
    chatSelectorLoading.value = false
  }
}

async function handleChatSelectorCancel() {
  const source = preparedImportSource.value
  preparedImportSource.value = null
  pendingWebFile.value = null
  chatSelectorFilePath.value = ''
  chatSelectorChats.value = []
  if (source) {
    await useImportService().releaseImportSource(source.sourceId)
  }
}

// 文件夹导入模式
const folderImportEnabled = ref(false)

// 处理文件选择（点击选择）
async function handleClickImport() {
  importError.value = null
  hasImportLog.value = false
  importDiagnostics.value = null

  if (folderImportEnabled.value) {
    handleClickImportDirectory()
    return
  }

  if (IS_ELECTRON) {
    const result = await usePlatformService().showOpenDialog({
      title: t('home.import.selectFiles'),
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: t('home.import.chatRecords'), extensions: ['json', 'jsonl', 'txt', 'zip'] },
        { name: t('home.import.allFiles'), extensions: ['*'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) return
    await processFilePaths(result.filePaths)
  } else {
    dropZoneRef.value?.openFileDialog()
  }
}

// 处理文件拖拽/选择 - 支持 Electron 路径和 Web File 对象
async function handleFileDrop({ files, paths }: { files: File[]; paths: string[] }) {
  importError.value = null
  hasImportLog.value = false
  importDiagnostics.value = null

  if (IS_ELECTRON && paths.length > 0) {
    await processFilePaths(paths)
  } else if (files.length > 0) {
    await processWebFiles(files)
  } else {
    importError.value = t('home.import.cannotReadPath')
  }
}

// Web 模式：使用 ImportService 导入 File 对象
async function processWebFiles(files: File[]) {
  const importService = useImportService()

  if (files.length === 1) {
    const file = files[0]
    if (isArchiveFile(file)) {
      await prepareArchiveImport(file)
      return
    }

    const format = await importService.detectFormat(file)
    if (format?.multiChat) {
      pendingWebFile.value = file
      const chats = await importService.scanMultiChatFile(file)
      if (chats.length > 0) {
        chatSelectorChats.value = chats.map(mapLegacyChat)
        chatSelectorError.value = null
        showChatSelector.value = true
        return
      }
    }

    if (!format) {
      pendingFormatFile.value = file
      formatSelectorFilePath.value = file.name
    }

    await importSingleWebFile(file)
  } else {
    if (files.some(isArchiveFile)) {
      importError.value = translateError('error.archive_single_file_required')
      return
    }
    for (const file of files) {
      await importSingleWebFile(file)
    }
  }
}

const pendingWebFile = ref<File | null>(null)

async function importSingleWebFile(file: File, options?: { formatId?: string; chatIndex?: number }) {
  isImporting.value = true
  importProgress.value = { stage: 'detecting', progress: 0, message: '' }

  try {
    const result = await useImportService().importFile(file, options, (p) => {
      if (p.stage === 'done') return
      importProgress.value = p
    })

    if (importProgress.value) {
      importProgress.value.progress = 100
    }
    await new Promise((resolve) => setTimeout(resolve, 300))

    if (result.success && result.sessionId) {
      await sessionStore.loadSessions()
      sessionStore.selectSession(result.sessionId)
      await navigateToSession(result.sessionId)
    } else {
      importError.value = translateError(result.error || 'error.import_failed')
    }
  } catch (error) {
    importError.value = String(error)
  } finally {
    isImporting.value = false
    setTimeout(() => {
      importProgress.value = null
    }, 500)
  }
}

// 目录导入 ref
const dirDropZoneRef = ref<InstanceType<typeof FileDropZone> | null>(null)

async function handleClickImportDirectory() {
  importError.value = null
  if (IS_ELECTRON) {
    const result = await usePlatformService().showOpenDialog({
      title: t('home.import.selectFolder'),
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return
    await importDirectory(result.filePaths[0])
  } else {
    dirDropZoneRef.value?.openFileDialog()
  }
}

async function handleDirectoryDrop({ files }: { files: File[]; paths: string[] }) {
  if (files.length === 0) return
  importError.value = null
  await importDirectory(files)
}

async function handleDirectoryDropEvent({ files, dirPath }: { files: File[]; dirPath: string | null }) {
  importError.value = null
  hasImportLog.value = false
  importDiagnostics.value = null

  if (dirPath) {
    await importDirectory(dirPath)
  } else if (files.length > 0) {
    await importDirectory(files)
  }
}

async function importDirectory(source: File[] | string) {
  isImporting.value = true
  importProgress.value = { stage: 'detecting', progress: 0, message: '' }

  try {
    const result = await useImportService().importDirectory(source, undefined, (p) => {
      if (p.stage === 'done') return
      importProgress.value = p
    })

    if (importProgress.value) {
      importProgress.value.progress = 100
    }
    await new Promise((resolve) => setTimeout(resolve, 300))

    if (result.success && result.sessionId) {
      await sessionStore.loadSessions()
      sessionStore.selectSession(result.sessionId)
      await navigateToSession(result.sessionId)
    } else {
      importError.value = translateError(result.error || 'error.import_failed')
    }
  } catch (error) {
    importError.value = String(error)
  } finally {
    isImporting.value = false
    setTimeout(() => {
      importProgress.value = null
    }, 500)
  }
}

// 统一处理文件路径（单文件或多文件）- Electron only
async function processFilePaths(paths: string[]) {
  if (paths.some(isArchiveFile)) {
    if (paths.length !== 1) {
      importError.value = translateError('error.archive_single_file_required')
      return
    }
    await prepareArchiveImport(paths[0])
    return
  }

  // 单文件 或 未启用合并导入 - 使用原有逻辑
  if (paths.length === 1 || !mergeImportEnabled.value) {
    if (paths.length === 1) {
      const format = await useImportService().detectFormat(paths[0])
      if (format?.multiChat) {
        chatSelectorFilePath.value = paths[0]
        const chats = await useImportService().scanMultiChatFile(paths[0])
        if (chats.length > 0) {
          chatSelectorChats.value = chats.map(mapLegacyChat)
          chatSelectorError.value = null
          showChatSelector.value = true
        } else {
          importError.value = t('home.chatSelector.scanFailed')
        }
        return
      }

      // 单文件导入
      const result = await sessionStore.importFileFromPath(paths[0])
      if (!result.success && result.error) {
        importError.value = translateError(result.error)
        // 格式无法识别时，记住文件路径以便手动选择格式
        if (result.error === 'error.unrecognized_format') {
          formatSelectorFilePath.value = paths[0]
        }
        // 保存诊断信息
        if (result.diagnostics) {
          importDiagnostics.value = {
            logFile: result.diagnostics.logFile,
            detectedFormat: result.diagnostics.detectedFormat,
            messagesReceived: result.diagnostics.messagesReceived,
            messagesWritten: result.diagnostics.messagesWritten,
            messagesSkipped: result.diagnostics.messagesSkipped,
          }
          // 如果有日志文件，显示查看日志按钮
          hasImportLog.value = !!result.diagnostics.logFile
        } else {
          await checkImportLog()
        }
      } else if (result.success && sessionStore.currentSessionId) {
        await navigateToSession(sessionStore.currentSessionId)
      }
    } else {
      // 多文件批量导入（未启用合并）
      await sessionStore.importFilesFromPaths(paths)
    }
    return
  }

  // 多文件 + 合并导入（调用 store 方法）
  await sessionStore.mergeImportFiles(paths)
}

const pendingFormatFile = ref<File | null>(null)

// 手动格式选择后的导入处理
async function handleFormatSelect(formatId: string) {
  if (!IS_ELECTRON && pendingFormatFile.value) {
    const file = pendingFormatFile.value
    pendingFormatFile.value = null
    await importSingleWebFile(file, { formatId })
    return
  }

  const filePath = formatSelectorFilePath.value
  if (!filePath) return

  importError.value = null
  importDiagnostics.value = null
  isImporting.value = true
  importProgress.value = { stage: 'detecting', progress: 0, message: '' }

  try {
    const result = await useImportService().importFile(filePath, { formatId }, (progress) => {
      if (progress.stage === 'done') return
      importProgress.value = progress
    })

    if (importProgress.value) {
      importProgress.value.progress = 100
    }
    await new Promise((resolve) => setTimeout(resolve, 300))

    if (result.success && result.sessionId) {
      await sessionStore.loadSessions()
      sessionStore.selectSession(result.sessionId)
      await autoGenerateSessionIndex(result.sessionId)
      await navigateToSession(result.sessionId)
    } else {
      importError.value = translateError(result.error || 'error.import_failed')
    }
  } catch (error) {
    importError.value = String(error)
  } finally {
    isImporting.value = false
    setTimeout(() => {
      importProgress.value = null
    }, 500)
  }
}

// 聊天选择后的导入处理（通用，适用于 Telegram 等多聊天格式）
async function handleChatSelect(selectedChats: ChatInfo[]) {
  if (selectedChats.length === 0) return

  if (preparedImportSource.value) {
    const source = preparedImportSource.value
    preparedImportSource.value = null
    chatSelectorChats.value = []

    if (selectedChats.length === 1) {
      isImporting.value = true
      importProgress.value = { stage: 'detecting', progress: 0, message: '' }
      try {
        const result = await useImportService().importPreparedChat(
          source.sourceId,
          selectedChats[0].chatId,
          (progress) => {
            if (progress.stage !== 'done') importProgress.value = progress
          }
        )
        if (result.success && result.sessionId) {
          await sessionStore.loadSessions()
          sessionStore.selectSession(result.sessionId)
          await autoGenerateSessionIndex(result.sessionId)
          await navigateToSession(result.sessionId)
        } else {
          importError.value = translateError(result.error || 'error.import_failed')
        }
      } catch (error) {
        importError.value = translateError(error instanceof Error ? error.message : String(error))
      } finally {
        try {
          await useImportService().releaseImportSource(source.sourceId)
        } catch (error) {
          console.error('释放导入源失败:', error)
        } finally {
          isImporting.value = false
          importProgress.value = null
        }
      }
      return
    }

    batchImportCancelled.value = false
    isBatchImporting.value = true
    batchFiles.value = selectedChats.map((chat) => ({
      path: `archive:${source.sourceId}#${chat.chatId}`,
      name: chat.name,
      status: 'pending' as const,
    }))

    const batchResult = await runPreparedImportBatch({
      sourceId: source.sourceId,
      chats: selectedChats,
      isCancelled: () => batchImportCancelled.value,
      releaseSource: (sourceId) => useImportService().releaseImportSource(sourceId),
      onItemStart: (_chat, index) => {
        batchFiles.value[index].status = 'importing'
      },
      importChat: async (sourceId, chatId) => {
        const index = selectedChats.findIndex((chat) => chat.chatId === chatId)
        const result = await useImportService().importPreparedChat(sourceId, chatId, (progress) => {
          if (progress.stage !== 'done' && index >= 0) batchFiles.value[index].progress = progress
        })
        if (result.success && result.sessionId) {
          await autoGenerateSessionIndex(result.sessionId)
        }
        return result
      },
      onItemComplete: (_chat, index, result) => {
        const file = batchFiles.value[index]
        file.status = result.success ? 'success' : 'failed'
        file.sessionId = result.sessionId
        file.error = result.error
      },
    })

    for (let index = 0; index < batchResult.items.length; index++) {
      const item = batchResult.items[index]
      const file = batchFiles.value[index]
      if (item.status === 'cancelled') file.status = 'cancelled'
    }

    await sessionStore.loadSessions()
    isBatchImporting.value = false
    batchImportResult.value = {
      total: batchResult.total,
      success: batchResult.success,
      failed: batchResult.failed,
      cancelled: batchResult.cancelled,
      files: batchFiles.value.map((file) => ({ ...file })),
    }
    return
  }

  // Web 模式：使用 pendingWebFile + adapter
  if (!IS_ELECTRON && pendingWebFile.value) {
    const file = pendingWebFile.value
    pendingWebFile.value = null
    chatSelectorChats.value = []

    if (selectedChats.length === 1) {
      await importSingleWebFile(file, { chatIndex: selectedChats[0].index! })
    } else {
      for (const chat of selectedChats) {
        await importSingleWebFile(file, { chatIndex: chat.index! })
      }
    }
    return
  }

  const filePath = chatSelectorFilePath.value

  if (selectedChats.length === 1) {
    isImporting.value = true
    importProgress.value = { stage: 'detecting', progress: 0, message: '' }

    try {
      const result = await useImportService().importFile(
        filePath,
        { chatIndex: selectedChats[0].index! },
        (progress) => {
          if (progress.stage === 'done') return
          importProgress.value = progress
        }
      )

      if (importProgress.value) {
        importProgress.value.progress = 100
      }
      await new Promise((resolve) => setTimeout(resolve, 300))

      if (result.success && result.sessionId) {
        await sessionStore.loadSessions()
        sessionStore.selectSession(result.sessionId)
        await autoGenerateSessionIndex(result.sessionId)
        await navigateToSession(result.sessionId)
      } else {
        importError.value = translateError(result.error || 'error.import_failed')
      }
    } catch (error) {
      importError.value = String(error)
    } finally {
      isImporting.value = false
      setTimeout(() => {
        importProgress.value = null
      }, 500)
    }
  } else {
    isBatchImporting.value = true
    batchFiles.value = selectedChats.map((chat) => ({
      path: `${filePath}#${chat.index}`,
      name: chat.name || chat.chatId,
      status: 'pending' as const,
    }))

    let successCount = 0
    let failedCount = 0

    for (let i = 0; i < selectedChats.length; i++) {
      const chat = selectedChats[i]
      batchFiles.value[i].status = 'importing'

      try {
        const result = await useImportService().importFile(filePath, { chatIndex: chat.index! }, (progress) => {
          if (progress.stage === 'done') return
          batchFiles.value[i].progress = progress
        })

        if (result.success && result.sessionId) {
          batchFiles.value[i].status = 'success'
          batchFiles.value[i].sessionId = result.sessionId
          successCount++
          await autoGenerateSessionIndex(result.sessionId)
        } else {
          batchFiles.value[i].status = 'failed'
          batchFiles.value[i].error = result.error
          failedCount++
        }
      } catch (error) {
        batchFiles.value[i].status = 'failed'
        batchFiles.value[i].error = String(error)
        failedCount++
      }
    }

    await sessionStore.loadSessions()

    isBatchImporting.value = false
    batchImportResult.value = {
      total: selectedChats.length,
      success: successCount,
      failed: failedCount,
      cancelled: 0,
      files: batchFiles.value.map((f) => ({
        path: f.path,
        name: f.name,
        status: f.status,
        sessionId: f.sessionId,
        error: f.error,
      })),
    }
  }
}

// 关闭合并结果并跳转
async function handleMergeGoToSession() {
  if (mergeResult.value?.sessionId) {
    const sessionId = mergeResult.value.sessionId
    sessionStore.clearMergeImportResult()
    await navigateToSession(sessionId)
  }
}

// 关闭合并结果
function closeMergeResult() {
  sessionStore.clearMergeImportResult()
}

// 取消批量导入
function handleCancelBatchImport() {
  sessionStore.cancelBatchImport()
}

// 关闭结果摘要
function handleCloseResult() {
  sessionStore.clearBatchImportResult()
}

// 跳转到指定会话
async function handleGoToSession(sessionId: string) {
  sessionStore.clearBatchImportResult()
  await navigateToSession(sessionId)
}

// 打开最新的导入日志文件
async function openLatestImportLog() {
  const result = await useCacheService().getLatestImportLog()
  if (result.success && result.path) {
    await useCacheService().showInFolder(result.path)
  } else {
    await useCacheService().openDir('logs')
  }
}

function getProgressText(): string {
  if (!importProgress.value) return ''
  switch (importProgress.value.stage) {
    case 'detecting':
      return t('home.import.progress.detecting')
    case 'reading':
      return t('home.import.progress.reading')
    case 'parsing':
      return t('home.import.progress.parsing')
    case 'saving':
      return t('home.import.progress.saving')
    case 'indexing':
      return t('home.import.progress.indexing')
    case 'done':
      return t('home.import.progress.done')
    case 'error':
      return t('home.import.progress.error')
    default:
      return ''
  }
}

function getProgressDetail(): string {
  if (!importProgress.value) return ''
  const { messagesProcessed, totalBytes, bytesRead } = importProgress.value

  if (messagesProcessed && messagesProcessed > 0) {
    return t('home.import.processed', { count: messagesProcessed.toLocaleString() })
  }

  if (totalBytes && bytesRead) {
    const percent = Math.round((bytesRead / totalBytes) * 100)
    const mbRead = (bytesRead / 1024 / 1024).toFixed(1)
    const mbTotal = (totalBytes / 1024 / 1024).toFixed(1)
    return `${mbRead} MB / ${mbTotal} MB (${percent}%)`
  }

  return importProgress.value.message || ''
}

// 文件状态配置
const STATUS_CONFIG: Record<string, { icon: string; class: string }> = {
  pending: { icon: 'i-heroicons-clock', class: 'text-gray-400' },
  importing: { icon: 'i-heroicons-arrow-path', class: 'text-pink-500 animate-spin' },
  parsing: { icon: 'i-heroicons-arrow-path', class: 'text-pink-500 animate-spin' },
  success: { icon: 'i-heroicons-check-circle', class: 'text-green-500' },
  done: { icon: 'i-heroicons-check-circle', class: 'text-green-500' },
  failed: { icon: 'i-heroicons-x-circle', class: 'text-red-500' },
  cancelled: { icon: 'i-heroicons-minus-circle', class: 'text-gray-400' },
}

const getStatusIcon = (status: string) => STATUS_CONFIG[status]?.icon ?? 'i-heroicons-question-mark-circle'
const getStatusClass = (status: string) => STATUS_CONFIG[status]?.class ?? 'text-gray-400'

// 获取批量导入文件进度描述
function getBatchFileProgressText(file: BatchFileInfo): string {
  if (file.status === 'pending') return t('home.import.batch.waiting')
  if (file.status === 'cancelled') return t('home.import.batch.skipped')
  if (file.status === 'success') return t('home.import.batch.success')
  if (file.status === 'failed') return translateError(file.error || 'error.import_failed')
  // importing 状态
  if (file.progress) {
    const { stage, messagesProcessed } = file.progress
    if (stage === 'parsing' && messagesProcessed) {
      return t('home.import.processed', { count: messagesProcessed.toLocaleString() })
    }
    return t(`home.import.progress.${stage}`)
  }
  return ''
}

// 获取合并文件进度描述
const getMergeFileProgressText = (file: MergeFileInfo) =>
  file.info ? t('home.import.merge.messageCount', { count: file.info.messageCount.toLocaleString() }) : ''
</script>

<template>
  <div class="w-full flex flex-col items-center space-y-6">
    <!-- 批量导入进度（导入中） -->
    <div
      v-if="isBatchImporting && batchFiles.length > 0"
      class="w-full max-w-4xl rounded-3xl border border-gray-200/50 bg-gray-100/50 px-8 py-6 backdrop-blur-md dark:border-white/10 dark:bg-gray-800/40"
    >
      <!-- 标题和进度 -->
      <div class="mb-4 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-pink-50 dark:bg-pink-500/10">
            <UIcon name="i-heroicons-arrow-path" class="h-5 w-5 animate-spin text-pink-600 dark:text-pink-400" />
          </div>
          <div>
            <p class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ t('home.import.batch.importing') }}
            </p>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              {{
                t('home.import.batch.progressCount', {
                  current: (batchProgress?.completed || 0) + 1,
                  total: batchProgress?.total || 0,
                })
              }}
            </p>
          </div>
        </div>
        <UButton color="error" variant="soft" size="sm" icon="i-heroicons-stop-circle" @click="handleCancelBatchImport">
          {{ t('home.import.batch.cancel') }}
        </UButton>
      </div>

      <!-- 文件列表 -->
      <div class="max-h-52 space-y-2 overflow-y-auto">
        <FileListItem
          v-for="(file, index) in batchFiles"
          :key="file.path"
          :name="file.name"
          :status-icon="getStatusIcon(file.status)"
          :status-class="getStatusClass(file.status)"
          :progress-text="getBatchFileProgressText(file)"
          :index="index"
          :total="batchFiles.length"
          :highlight="file.status === 'importing'"
        />
      </div>
    </div>

    <!-- 合并导入进度 -->
    <div
      v-else-if="isMergeImporting && mergeStage !== 'done'"
      class="w-full max-w-4xl rounded-3xl border border-gray-200/50 bg-gray-100/50 px-8 py-6 backdrop-blur-md dark:border-white/10 dark:bg-gray-800/40"
    >
      <!-- 标题 -->
      <div class="mb-4 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-pink-50 dark:bg-pink-500/10">
            <UIcon
              v-if="mergeStage !== 'error'"
              name="i-heroicons-arrow-path"
              class="h-5 w-5 animate-spin text-pink-600 dark:text-pink-400"
            />
            <UIcon v-else name="i-heroicons-x-circle" class="h-5 w-5 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <p class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ mergeStage === 'error' ? t('home.import.merge.failed') : t('home.import.merge.importing') }}
            </p>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              {{ mergeStage === 'parsing' ? t('home.import.merge.parsing') : '' }}
              {{ mergeStage === 'merging' ? t('home.import.merge.merging') : '' }}
              {{ mergeStage === 'error' ? mergeError : '' }}
            </p>
          </div>
        </div>
        <UButton
          v-if="mergeStage === 'error'"
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-heroicons-x-mark"
          @click="closeMergeResult"
        />
      </div>

      <!-- 文件列表 -->
      <div class="max-h-52 space-y-2 overflow-y-auto">
        <FileListItem
          v-for="(file, index) in mergeFiles"
          :key="file.path"
          :name="file.name"
          :status-icon="getStatusIcon(file.status)"
          :status-class="getStatusClass(file.status)"
          :progress-text="getMergeFileProgressText(file)"
          :index="index"
          :total="mergeFiles.length"
          :highlight="file.status === 'parsing'"
        />
      </div>
    </div>

    <!-- 合并导入完成 -->
    <div
      v-else-if="isMergeImporting && mergeStage === 'done' && mergeResult"
      class="w-full max-w-4xl rounded-3xl border border-gray-200/50 bg-gray-100/50 px-8 py-6 backdrop-blur-md dark:border-white/10 dark:bg-gray-800/40"
    >
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-green-50 dark:bg-green-500/10">
            <UIcon name="i-heroicons-check-circle" class="h-5 w-5 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <p class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ t('home.import.merge.completed') }}
            </p>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              {{ t('home.import.merge.completedHint', { count: mergeFiles.length }) }}
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <UButton color="neutral" variant="ghost" size="sm" icon="i-heroicons-x-mark" @click="closeMergeResult" />
          <UButton size="sm" @click="handleMergeGoToSession">
            {{ t('home.import.batch.view') }}
          </UButton>
        </div>
      </div>
    </div>

    <!-- 批量导入结果摘要 -->
    <div
      v-else-if="batchImportResult"
      class="w-full max-w-4xl rounded-3xl border border-gray-200/50 bg-gray-100/50 px-8 py-6 backdrop-blur-md dark:border-white/10 dark:bg-gray-800/40"
    >
      <!-- 标题 -->
      <div class="mb-4 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div
            class="flex h-10 w-10 items-center justify-center rounded-xl"
            :class="
              batchImportResult.failed === 0 ? 'bg-green-50 dark:bg-green-500/10' : 'bg-amber-50 dark:bg-amber-500/10'
            "
          >
            <UIcon
              :name="batchImportResult.failed === 0 ? 'i-heroicons-check-circle' : 'i-heroicons-exclamation-triangle'"
              class="h-5 w-5"
              :class="
                batchImportResult.failed === 0
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-amber-600 dark:text-amber-400'
              "
            />
          </div>
          <div>
            <p class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ t('home.import.batch.completed') }}
            </p>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              {{
                t('home.import.batch.summary', {
                  success: batchImportResult.success,
                  failed: batchImportResult.failed,
                  cancelled: batchImportResult.cancelled,
                })
              }}
            </p>
          </div>
        </div>
        <UButton color="neutral" variant="ghost" size="sm" icon="i-heroicons-x-mark" @click="handleCloseResult" />
      </div>

      <!-- 文件列表 -->
      <div class="max-h-52 space-y-2 overflow-y-auto">
        <FileListItem
          v-for="(file, index) in batchImportResult.files"
          :key="file.path"
          :name="file.name"
          :status-icon="getStatusIcon(file.status)"
          :status-class="getStatusClass(file.status)"
          :index="index"
          :total="batchImportResult.files.length"
        >
          <template #extra>
            <p v-if="file.status === 'failed'" class="text-xs text-red-500">
              {{ translateError(file.error || 'error.import_failed') }}
            </p>
            <p v-else-if="file.status === 'cancelled'" class="text-xs text-gray-500">
              {{ t('home.import.batch.skipped') }}
            </p>
          </template>
          <template v-if="file.status === 'success' && file.sessionId" #action>
            <UButton size="xs" variant="soft" @click="handleGoToSession(file.sessionId!)">
              {{ t('home.import.batch.view') }}
            </UButton>
          </template>
        </FileListItem>
      </div>
    </div>

    <!-- 默认导入区域（非批量状态） -->
    <FileDropZone
      v-else
      ref="dropZoneRef"
      :accept="['.json', '.jsonl', '.txt', '.zip']"
      :disabled="isAnyImporting"
      :multiple="true"
      class="w-full max-w-md"
      @files="handleFileDrop"
      @directory-drop="handleDirectoryDropEvent"
    >
      <template #default="{ isDragOver }">
        <div
          class="group relative flex w-full cursor-pointer flex-col items-center justify-center rounded-3xl border border-gray-200/50 bg-gray-100/50 px-8 h-[190px] sm:h-[220px] backdrop-blur-md transition-all duration-300 hover:border-pink-500/30 hover:bg-gray-100/80 hover:shadow-2xl hover:shadow-pink-500/10 focus:outline-none focus:ring-4 focus:ring-pink-500/20 sm:px-12 dark:border-white/10 dark:bg-gray-800/40 dark:hover:border-pink-500/30 dark:hover:bg-gray-800/60"
          :class="{
            'border-pink-500/50 bg-pink-50/50 dark:border-pink-400/50 dark:bg-pink-500/10':
              isDragOver && !isAnyImporting,
            'cursor-not-allowed opacity-70': isAnyImporting,
          }"
          @click="!isAnyImporting && handleClickImport()"
        >
          <!-- 上传图标容器 -->
          <div
            class="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl transition-transform duration-300 group-hover:scale-105"
            :class="{ 'scale-105': isDragOver && !isAnyImporting, 'animate-pulse': isImporting }"
          >
            <UIcon
              v-if="!isImporting"
              name="i-heroicons-arrow-up-tray"
              class="h-8 w-8 text-pink-600 transition-transform duration-200 group-hover:-translate-y-1 dark:text-pink-400"
            />
            <UIcon v-else name="i-heroicons-arrow-path" class="h-8 w-8 animate-spin text-pink-600 dark:text-pink-400" />
          </div>

          <!-- Text -->
          <div class="w-full min-w-80 text-center">
            <template v-if="isImporting && importProgress">
              <!-- 导入中显示进度 -->
              <p class="mb-4 text-lg font-semibold text-gray-900 dark:text-white">{{ getProgressText() }}</p>
              <div class="mx-auto w-full max-w-md">
                <UProgress v-model="importProgress.progress" size="md" />
              </div>
              <p class="mt-3 text-sm text-gray-500 dark:text-gray-400">
                {{ getProgressDetail() }}
              </p>
            </template>
            <template v-else>
              <!-- 默认状态 -->
              <p class="text-lg font-semibold text-gray-900 dark:text-white">
                {{ isDragOver ? t('home.import.dropHint') : t('home.import.clickHint') }}
              </p>
              <p class="mt-3 text-sm text-gray-500 dark:text-gray-400">
                {{ t('home.import.multipleHint') }}
              </p>
            </template>
          </div>
        </div>
      </template>
    </FileDropZone>

    <!-- 隐藏的目录选择 input -->
    <FileDropZone ref="dirDropZoneRef" :directory="true" class="hidden" @files="handleDirectoryDrop" />

    <!-- 导入选项 -->
    <div v-if="!isAnyImporting && !batchImportResult" class="h-6 flex flex-wrap items-center justify-center gap-4">
      <!-- 导入文件夹模式 -->
      <UCheckbox
        v-model="folderImportEnabled"
        :label="t('home.import.importFolder')"
        input-class="h-4 w-4"
        size="sm"
        label-class="text-sm font-medium text-gray-600 dark:text-gray-300"
      />

      <!-- 合并导入 -->
      <div class="flex items-center gap-2">
        <UCheckbox
          v-model="mergeImportEnabled"
          :label="t('home.import.options.mergeImport')"
          input-class="h-4 w-4"
          size="sm"
          label-class="text-sm font-medium text-gray-600 dark:text-gray-300"
        />
        <UPopover mode="hover">
          <UIcon
            name="i-heroicons-question-mark-circle"
            class="h-4 w-4 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
          />
          <template #content>
            <div class="max-w-xs px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
              {{ t('home.import.options.mergeImportHint') }}
            </div>
          </template>
        </UPopover>
      </div>
    </div>

    <!-- Error Message -->
    <div
      v-if="importError"
      class="flex max-w-lg flex-col items-center gap-3 rounded-lg bg-red-50 px-4 py-4 dark:bg-red-900/20"
    >
      <div class="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
        <UIcon name="i-heroicons-exclamation-circle" class="h-5 w-5 shrink-0" />
        <span>{{ importError }}</span>
      </div>
      <!-- 诊断信息（如果有） -->
      <div
        v-if="importDiagnostics"
        class="w-full rounded-md bg-gray-100 px-3 py-2 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300"
      >
        <div class="flex items-start gap-2">
          <UIcon name="i-heroicons-chart-bar" class="mt-0.5 h-4 w-4 shrink-0" />
          <div class="space-y-1">
            <div v-if="importDiagnostics.detectedFormat">
              {{ t('home.import.diagnostics.format') }}{{ importDiagnostics.detectedFormat }}
            </div>
            <div>
              {{ t('home.import.diagnostics.received') }}{{ importDiagnostics.messagesReceived }}
              {{ t('home.import.diagnostics.written') }}{{ importDiagnostics.messagesWritten }}
              {{ t('home.import.diagnostics.skipped') }}{{ importDiagnostics.messagesSkipped }}
            </div>
          </div>
        </div>
      </div>
      <p v-if="formatSelectorFilePath || hasImportLog" class="text-xs text-gray-500 dark:text-gray-400">
        {{ t('home.import.errors.actionHint') }}
      </p>
      <div class="flex gap-2">
        <UButton v-if="formatSelectorFilePath" size="xs" @click="showFormatSelector = true">
          {{ t('home.formatSelector.manualSelect') }}
        </UButton>
        <UButton v-if="hasImportLog" size="xs" variant="soft" @click="openLatestImportLog">
          {{ t('home.import.viewLog') }}
        </UButton>
      </div>
    </div>

    <!-- 聊天选择器（多聊天格式通用） -->
    <ChatSelector
      v-model:open="showChatSelector"
      :chats="chatSelectorChats"
      :loading="chatSelectorLoading"
      :error="chatSelectorError"
      @select="handleChatSelect"
      @cancel="handleChatSelectorCancel"
    />

    <!-- 格式选择器（自动检测失败时的手动兜底） -->
    <FormatSelectorModal
      v-model:open="showFormatSelector"
      :file-path="formatSelectorFilePath"
      @select="handleFormatSelect"
    />
  </div>
</template>
