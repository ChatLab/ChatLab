import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AnalysisSession, ImportProgress } from '@/types/base'

/** 迁移信息 */
export interface MigrationInfo {
  version: number
  /** 技术描述（面向开发者） */
  description: string
  /** 用户可读的升级原因（显示在弹窗中） */
  userMessage: string
}

/** 迁移检查结果 */
export interface MigrationCheckResult {
  needsMigration: boolean
  count: number
  currentVersion: number
  pendingMigrations: MigrationInfo[]
}

/** 批量导入文件状态 */
export type BatchFileStatus = 'pending' | 'importing' | 'success' | 'failed' | 'cancelled'

/** 批量导入单个文件信息 */
export interface BatchFileInfo {
  path: string
  name: string
  status: BatchFileStatus
  progress?: ImportProgress
  error?: string
  diagnosisSuggestion?: string
  sessionId?: string
}

/** 批量导入结果 */
export interface BatchImportResult {
  total: number
  success: number
  failed: number
  cancelled: number
  files: BatchFileInfo[]
}

/** 合并导入文件状态 */
export type MergeFileStatus = 'pending' | 'parsing' | 'done'

/** 合并导入单个文件信息 */
export interface MergeFileInfo {
  path: string
  name: string
  status: MergeFileStatus
  info?: {
    name: string
    format: string
    platform: string
    messageCount: number
    memberCount: number
    fileSize?: number
  }
}

/** 合并导入阶段 */
export type MergeImportStage = 'parsing' | 'merging' | 'done' | 'error'

/** 合并导入结果 */
export interface MergeImportResult {
  success: boolean
  sessionId?: string
  error?: string
}

/**
 * 会话与导入相关的全局状态
 */
export const useSessionStore = defineStore(
  'session',
  () => {
    // 会话列表
    const sessions = ref<AnalysisSession[]>([])
    // 当前会话 ID
    const currentSessionId = ref<string | null>(null)
    // 导入状态
    const isImporting = ref(false)
    const importProgress = ref<ImportProgress | null>(null)
    // 是否初始化完成
    const isInitialized = ref(false)

    // 批量导入状态
    const isBatchImporting = ref(false)
    const batchFiles = ref<BatchFileInfo[]>([])
    const batchImportCancelled = ref(false)
    const batchImportResult = ref<BatchImportResult | null>(null)

    // 合并导入状态
    const isMergeImporting = ref(false)
    const mergeFiles = ref<MergeFileInfo[]>([])
    const mergeStage = ref<MergeImportStage>('parsing')
    const mergeError = ref<string | null>(null)
    const mergeResult = ref<MergeImportResult | null>(null)

    // 当前选中的会话
    const currentSession = computed(() => {
      if (!currentSessionId.value) return null
      return sessions.value.find((s) => s.id === currentSessionId.value) || null
    })

    // 迁移相关状态
    const migrationNeeded = ref(false)
    const migrationCount = ref(0)
    const pendingMigrations = ref<MigrationInfo[]>([])
    const isMigrating = ref(false)

    /**
     * 检查是否需要数据库迁移
     */
    async function checkMigration(): Promise<MigrationCheckResult> {
      try {
        const result = await window.chatApi.checkMigration()
        migrationNeeded.value = result.needsMigration
        migrationCount.value = result.count
        pendingMigrations.value = result.pendingMigrations || []
        return result
      } catch (error) {
        console.error('检查迁移失败:', error)
        return { needsMigration: false, count: 0, currentVersion: 0, pendingMigrations: [] }
      }
    }

    /**
     * 执行数据库迁移
     */
    async function runMigration(): Promise<{ success: boolean; error?: string }> {
      isMigrating.value = true
      try {
        const result = await window.chatApi.runMigration()
        if (result.success) {
          migrationNeeded.value = false
          migrationCount.value = 0
        }
        return result
      } catch (error) {
        console.error('执行迁移失败:', error)
        return { success: false, error: String(error) }
      } finally {
        isMigrating.value = false
      }
    }

    /**
     * 从数据库加载会话列表
     */
    async function loadSessions() {
      try {
        const list = await window.chatApi.getSessions()
        sessions.value = list
        // 如果当前选中的会话不存在了，清除选中状态
        if (currentSessionId.value && !list.find((s) => s.id === currentSessionId.value)) {
          currentSessionId.value = null
        }
        isInitialized.value = true
      } catch (error) {
        console.error('加载会话列表失败:', error)
        isInitialized.value = true
      }
    }

    /**
     * 选择文件并导入
     */
    async function importFile(): Promise<{
      success: boolean
      error?: string
      diagnosisSuggestion?: string
    }> {
      try {
        const result = await window.chatApi.selectFile()
        // 用户取消选择
        if (!result) {
          return { success: false, error: 'error.no_file_selected' }
        }
        // 有错误（如格式不识别）- 优先检查错误，因为此时可能没有 filePath
        if (result.error) {
          const diagnosisSuggestion = result.diagnosis?.suggestion
          return { success: false, error: result.error, diagnosisSuggestion }
        }
        // 没有文件路径（用户取消）
        if (!result.filePath) {
          return { success: false, error: 'error.no_file_selected' }
        }
        return await importFileFromPath(result.filePath)
      } catch (error) {
        return { success: false, error: String(error) }
      }
    }

    /** 导入诊断信息类型 */
    interface ImportDiagnosticsInfo {
      logFile: string | null
      detectedFormat: string | null
      messagesReceived: number
      messagesWritten: number
      messagesSkipped: number
      skipReasons: {
        noSenderId: number
        noAccountName: number
        invalidTimestamp: number
        noType: number
      }
    }

    /**
     * 从指定路径执行导入（支持拖拽）
     */
    async function importFileFromPath(filePath: string): Promise<{
      success: boolean
      error?: string
      diagnosisSuggestion?: string
      diagnostics?: ImportDiagnosticsInfo
    }> {
      try {
        isImporting.value = true
        importProgress.value = {
          stage: 'detecting',
          progress: 0,
          message: '', // Progress text is handled by frontend i18n
        }

        // 进度队列控制
        const queue: ImportProgress[] = []
        let isProcessing = false
        let currentStage = 'reading'
        let lastStageTime = Date.now()
        const MIN_STAGE_TIME = 1000

        /**
         * 处理导入进度队列，确保阶段展示足够时间
         */
        const processQueue = async () => {
          if (isProcessing) return
          isProcessing = true

          while (queue.length > 0) {
            const next = queue[0]

            if (next.stage !== currentStage) {
              const elapsed = Date.now() - lastStageTime
              if (elapsed < MIN_STAGE_TIME) {
                await new Promise((resolve) => setTimeout(resolve, MIN_STAGE_TIME - elapsed))
              }
              currentStage = next.stage
              lastStageTime = Date.now()
            }

            importProgress.value = queue.shift()!
          }
          isProcessing = false
        }

        const unsubscribe = window.chatApi.onImportProgress((progress) => {
          if (progress.stage === 'done') return
          queue.push(progress)
          processQueue()
        })

        const importResult = await window.chatApi.import(filePath)
        unsubscribe()

        while (queue.length > 0 || isProcessing) {
          await new Promise((resolve) => setTimeout(resolve, 100))
        }

        const elapsed = Date.now() - lastStageTime
        if (elapsed < MIN_STAGE_TIME) {
          await new Promise((resolve) => setTimeout(resolve, MIN_STAGE_TIME - elapsed))
        }

        if (importProgress.value) {
          importProgress.value.progress = 100
        }
        await new Promise((resolve) => setTimeout(resolve, 300))

        if (importResult.success && importResult.sessionId) {
          await loadSessions()
          currentSessionId.value = importResult.sessionId

          // 自动生成会话索引
          try {
            const savedThreshold = localStorage.getItem('sessionGapThreshold')
            const gapThreshold = savedThreshold ? parseInt(savedThreshold, 10) : 1800 // 默认30分钟
            await window.sessionApi.generate(importResult.sessionId, gapThreshold)
          } catch (error) {
            console.error('自动生成会话索引失败:', error)
            // 不阻断导入流程，用户可以手动生成
          }

          return { success: true, diagnostics: importResult.diagnostics }
        } else {
          // 传递诊断信息（如果有）
          const diagnosisSuggestion = importResult.diagnosis?.suggestion
          return {
            success: false,
            error: importResult.error || 'error.import_failed',
            diagnosisSuggestion,
            diagnostics: importResult.diagnostics,
          }
        }
      } catch (error) {
        return { success: false, error: String(error) }
      } finally {
        isImporting.value = false
        setTimeout(() => {
          importProgress.value = null
        }, 500)
      }
    }

    /**
     * 批量导入多个文件（串行执行）
     */
    async function importFilesFromPaths(filePaths: string[]): Promise<BatchImportResult> {
      if (filePaths.length === 0) {
        return { total: 0, success: 0, failed: 0, cancelled: 0, files: [] }
      }

      // 初始化批量导入状态
      isBatchImporting.value = true
      batchImportCancelled.value = false
      batchImportResult.value = null

      // 初始化文件列表
      batchFiles.value = filePaths.map((path) => ({
        path,
        name: path.split('/').pop() || path.split('\\').pop() || path,
        status: 'pending' as BatchFileStatus,
      }))

      let successCount = 0
      let failedCount = 0
      let cancelledCount = 0

      // 辅助函数：标记剩余文件为已取消
      const markRemainingAsCancelled = (startIndex: number) => {
        for (let j = startIndex; j < batchFiles.value.length; j++) {
          if (batchFiles.value[j].status === 'pending') {
            batchFiles.value[j].status = 'cancelled'
            cancelledCount++
          }
        }
      }

      // 串行导入每个文件
      for (let i = 0; i < batchFiles.value.length; i++) {
        // 检查是否已取消
        if (batchImportCancelled.value) {
          markRemainingAsCancelled(i)
          break
        }

        const file = batchFiles.value[i]
        file.status = 'importing'
        file.progress = {
          stage: 'detecting',
          progress: 0,
          message: '',
        }

        try {
          // 进度队列控制（复用单文件导入的逻辑）
          const queue: ImportProgress[] = []
          let isProcessing = false
          let currentStage = 'reading'
          let lastStageTime = Date.now()
          const MIN_STAGE_TIME = 300 // 批量导入时缩短阶段显示时间

          const processQueue = async () => {
            if (isProcessing) return
            isProcessing = true

            while (queue.length > 0) {
              // 在进度处理中也检查取消状态，加快响应
              if (batchImportCancelled.value) {
                queue.length = 0
                break
              }

              const next = queue[0]

              if (next.stage !== currentStage) {
                const elapsed = Date.now() - lastStageTime
                if (elapsed < MIN_STAGE_TIME) {
                  await new Promise((resolve) => setTimeout(resolve, MIN_STAGE_TIME - elapsed))
                }
                currentStage = next.stage
                lastStageTime = Date.now()
              }

              file.progress = queue.shift()!
            }
            isProcessing = false
          }

          const unsubscribe = window.chatApi.onImportProgress((progress) => {
            if (progress.stage === 'done') return
            queue.push(progress)
            processQueue()
          })

          const importResult = await window.chatApi.import(file.path)
          unsubscribe()

          // 等待进度队列处理完成（但如果已取消则快速跳过）
          let waitCount = 0
          while ((queue.length > 0 || isProcessing) && !batchImportCancelled.value && waitCount < 100) {
            await new Promise((resolve) => setTimeout(resolve, 30))
            waitCount++
          }

          // 当前文件导入完成后立即检查取消状态
          if (batchImportCancelled.value) {
            // 当前文件已经导入完成，记录其结果
            if (importResult.success && importResult.sessionId) {
              file.status = 'success'
              file.sessionId = importResult.sessionId
              successCount++

              // 即使取消了也要为已导入成功的文件生成会话索引
              try {
                const savedThreshold = localStorage.getItem('sessionGapThreshold')
                const gapThreshold = savedThreshold ? parseInt(savedThreshold, 10) : 1800
                await window.sessionApi.generate(importResult.sessionId, gapThreshold)
              } catch (error) {
                console.error('自动生成会话索引失败:', error)
              }
            } else {
              file.status = 'failed'
              file.error = importResult.error || 'error.import_failed'
              failedCount++
            }
            // 标记剩余文件为取消
            markRemainingAsCancelled(i + 1)
            break
          }

          if (importResult.success && importResult.sessionId) {
            file.status = 'success'
            file.sessionId = importResult.sessionId
            successCount++

            // 自动生成会话索引（跳过如果已取消）
            if (!batchImportCancelled.value) {
              try {
                const savedThreshold = localStorage.getItem('sessionGapThreshold')
                const gapThreshold = savedThreshold ? parseInt(savedThreshold, 10) : 1800
                await window.sessionApi.generate(importResult.sessionId, gapThreshold)
              } catch (error) {
                console.error('自动生成会话索引失败:', error)
              }
            }
          } else {
            file.status = 'failed'
            file.error = importResult.error || 'error.import_failed'
            file.diagnosisSuggestion = importResult.diagnosis?.suggestion
            failedCount++
          }
        } catch (error) {
          file.status = 'failed'
          file.error = String(error)
          failedCount++
        }
      }

      // 刷新会话列表
      await loadSessions()

      // 生成结果
      const result: BatchImportResult = {
        total: filePaths.length,
        success: successCount,
        failed: failedCount,
        cancelled: cancelledCount,
        files: [...batchFiles.value],
      }

      batchImportResult.value = result
      isBatchImporting.value = false

      return result
    }

    /**
     * 取消批量导入（跳过剩余文件）
     */
    function cancelBatchImport() {
      batchImportCancelled.value = true
    }

    /**
     * 清除批量导入结果（用于关闭摘要后重置状态）
     */
    function clearBatchImportResult() {
      batchImportResult.value = null
      batchFiles.value = []
    }

    /**
     * 合并导入多个文件为一个会话
     */
    async function mergeImportFiles(filePaths: string[]): Promise<MergeImportResult> {
      if (filePaths.length < 2) {
        return { success: false, error: '合并导入至少需要2个文件' }
      }

      // 阶段最小显示时间（和单文件导入保持一致）
      const MIN_STAGE_TIME = 800

      isMergeImporting.value = true
      mergeError.value = null
      mergeResult.value = null
      mergeStage.value = 'parsing'

      // 初始化文件列表
      mergeFiles.value = filePaths.map((path) => ({
        path,
        name: path.split('/').pop() || path.split('\\').pop() || path,
        status: 'pending' as MergeFileStatus,
      }))

      let stageStartTime = Date.now()

      try {
        // 阶段1：串行解析所有文件
        for (let i = 0; i < mergeFiles.value.length; i++) {
          const file = mergeFiles.value[i]
          const fileStartTime = Date.now()
          file.status = 'parsing'

          try {
            const info = await window.mergeApi.parseFileInfo(file.path)
            file.info = info

            // 确保每个文件的解析状态至少显示一定时间
            const elapsed = Date.now() - fileStartTime
            const minFileTime = Math.max(300, MIN_STAGE_TIME / filePaths.length)
            if (elapsed < minFileTime) {
              await new Promise((resolve) => setTimeout(resolve, minFileTime - elapsed))
            }

            file.status = 'done'
          } catch (err) {
            throw new Error(`解析文件失败: ${file.name} - ${err instanceof Error ? err.message : String(err)}`)
          }
        }

        // 确保解析阶段至少显示 MIN_STAGE_TIME
        const parsingElapsed = Date.now() - stageStartTime
        if (parsingElapsed < MIN_STAGE_TIME) {
          await new Promise((resolve) => setTimeout(resolve, MIN_STAGE_TIME - parsingElapsed))
        }

        // 阶段2：执行合并
        stageStartTime = Date.now()
        mergeStage.value = 'merging'

        // 智能命名：如果所有文件群名相同则用该名，否则用第一个文件的群名
        const names = mergeFiles.value.map((f) => f.info?.name).filter(Boolean)
        const uniqueNames = [...new Set(names)]
        const outputName = uniqueNames.length === 1 ? uniqueNames[0]! : names[0] || '合并记录'

        const result = await window.mergeApi.mergeFiles({
          filePaths,
          outputName,
          conflictResolutions: [], // 默认 keepBoth（保留所有消息）
          andAnalyze: true, // 合并后创建会话
        })

        if (!result.success) {
          throw new Error(result.error || '合并失败')
        }

        // 清理缓存
        await window.mergeApi.clearCache()

        // 确保合并阶段至少显示 MIN_STAGE_TIME
        const mergingElapsed = Date.now() - stageStartTime
        if (mergingElapsed < MIN_STAGE_TIME) {
          await new Promise((resolve) => setTimeout(resolve, MIN_STAGE_TIME - mergingElapsed))
        }

        mergeStage.value = 'done'
        mergeResult.value = { success: true, sessionId: result.sessionId }

        // 刷新会话列表
        await loadSessions()

        // 自动生成会话索引
        if (result.sessionId) {
          try {
            const savedThreshold = localStorage.getItem('sessionGapThreshold')
            const gapThreshold = savedThreshold ? parseInt(savedThreshold, 10) : 1800
            await window.sessionApi.generate(result.sessionId, gapThreshold)
          } catch (error) {
            console.error('自动生成会话索引失败:', error)
          }
        }

        return { success: true, sessionId: result.sessionId }
      } catch (err) {
        mergeStage.value = 'error'
        const errorMessage = err instanceof Error ? err.message : String(err)
        mergeError.value = errorMessage
        mergeResult.value = { success: false, error: errorMessage }
        // 清理缓存
        await window.mergeApi.clearCache()
        return { success: false, error: errorMessage }
      }
    }

    /**
     * 清除合并导入结果
     */
    function clearMergeImportResult() {
      isMergeImporting.value = false
      mergeFiles.value = []
      mergeResult.value = null
      mergeError.value = null
    }

    /**
     * 选择指定会话
     */
    function selectSession(id: string) {
      currentSessionId.value = id
    }

    /**
     * 删除会话
     */
    async function deleteSession(id: string): Promise<boolean> {
      try {
        const success = await window.chatApi.deleteSession(id)
        if (success) {
          const index = sessions.value.findIndex((s) => s.id === id)
          if (index !== -1) {
            sessions.value.splice(index, 1)
          }
          if (currentSessionId.value === id) {
            currentSessionId.value = null
          }
          await loadSessions()
        }
        return success
      } catch (error) {
        console.error('删除会话失败:', error)
        return false
      }
    }

    /**
     * 重命名会话
     */
    async function renameSession(id: string, newName: string): Promise<boolean> {
      try {
        const success = await window.chatApi.renameSession(id, newName)
        if (success) {
          const session = sessions.value.find((s) => s.id === id)
          if (session) {
            session.name = newName
          }
        }
        return success
      } catch (error) {
        console.error('重命名会话失败:', error)
        return false
      }
    }

    /**
     * 清空当前选中会话
     */
    function clearSelection() {
      currentSessionId.value = null
    }

    /**
     * 更新会话的所有者
     */
    async function updateSessionOwnerId(id: string, ownerId: string | null): Promise<boolean> {
      try {
        const success = await window.chatApi.updateSessionOwnerId(id, ownerId)
        if (success) {
          const session = sessions.value.find((s) => s.id === id)
          if (session) {
            session.ownerId = ownerId
          }
        }
        return success
      } catch (error) {
        console.error('更新会话所有者失败:', error)
        return false
      }
    }

    // 置顶会话 ID 列表
    const pinnedSessionIds = ref<string[]>([])

    // 排序后的会话列表
    const sortedSessions = computed(() => {
      // 建立索引映射，index 越大表示越晚置顶
      const pinIndexMap = new Map(pinnedSessionIds.value.map((id, index) => [id, index]))

      return [...sessions.value].sort((a, b) => {
        const aPinIndex = pinIndexMap.get(a.id)
        const bPinIndex = pinIndexMap.get(b.id)
        const aPinned = aPinIndex !== undefined
        const bPinned = bPinIndex !== undefined

        // 两个都置顶：后置顶的（index 大的）排前面
        if (aPinned && bPinned) {
          return bPinIndex! - aPinIndex!
        }
        // 只有一个置顶：置顶的排前面
        if (aPinned && !bPinned) return -1
        if (!aPinned && bPinned) return 1

        // 都不置顶：保持原顺序（通常是按时间倒序）
        return 0
      })
    })

    /**
     * 切换会话置顶状态
     */
    function togglePinSession(id: string) {
      const index = pinnedSessionIds.value.indexOf(id)
      if (index !== -1) {
        pinnedSessionIds.value.splice(index, 1)
      } else {
        pinnedSessionIds.value.push(id)
      }
    }

    /**
     * 检查会话是否已置顶
     */
    function isPinned(id: string): boolean {
      return pinnedSessionIds.value.includes(id)
    }

    return {
      sessions,
      sortedSessions,
      pinnedSessionIds,
      currentSessionId,
      isImporting,
      importProgress,
      isInitialized,
      currentSession,
      // 迁移相关
      migrationNeeded,
      migrationCount,
      pendingMigrations,
      isMigrating,
      checkMigration,
      runMigration,
      // 会话操作
      loadSessions,
      importFile,
      importFileFromPath,
      selectSession,
      deleteSession,
      renameSession,
      clearSelection,
      updateSessionOwnerId,
      togglePinSession,
      isPinned,
      // 批量导入
      isBatchImporting,
      batchFiles,
      batchImportCancelled,
      batchImportResult,
      importFilesFromPaths,
      cancelBatchImport,
      clearBatchImportResult,
      // 合并导入
      isMergeImporting,
      mergeFiles,
      mergeStage,
      mergeError,
      mergeResult,
      mergeImportFiles,
      clearMergeImportResult,
    }
  },
  {
    persist: [
      {
        pick: ['currentSessionId'],
        storage: sessionStorage,
      },
      {
        pick: ['pinnedSessionIds'],
        storage: localStorage,
      },
    ],
  }
)
