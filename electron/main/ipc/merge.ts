/**
 * 合并功能 IPC 处理器
 */

import { ipcMain } from 'electron'
import * as worker from '../worker/workerManager'
import * as merger from '../merger'
import { deleteTempDatabase, cleanupAllTempDatabases } from '../merger/tempCache'
import type { ParseProgress } from '../parser'
import type { MergeParams } from '../../../src/types/format'
import type { IpcContext } from './types'

// ==================== 临时数据库缓存 ====================
// 用于合并功能：缓存文件对应的临时数据库路径
// 这样用户删除本地文件后仍然可以进行合并（数据已存入临时数据库）
const tempDbCache = new Map<string, string>()

/**
 * 清理指定文件的缓存（删除临时数据库）
 */
function clearTempDbCache(filePath: string): void {
  const tempDbPath = tempDbCache.get(filePath)
  if (tempDbPath) {
    deleteTempDatabase(tempDbPath)
    tempDbCache.delete(filePath)
  }
}

/**
 * 清理所有缓存（删除所有临时数据库）
 */
export function cleanupTempDbs(): void {
  for (const tempDbPath of tempDbCache.values()) {
    deleteTempDatabase(tempDbPath)
  }
  tempDbCache.clear()
  console.log('[IpcMain] Cleaned up all temp databases')
}

/**
 * 初始化合并模块（清理残留临时数据库）
 */
export function initMergeModule(): void {
  cleanupAllTempDatabases()
}

/**
 * 注册合并功能 IPC 处理器
 */
export function registerMergeHandlers(ctx: IpcContext): void {
  const { win } = ctx

  /**
   * 解析文件获取基本信息（用于合并预览）
   * 使用流式解析，数据写入临时数据库，避免内存溢出
   */
  ipcMain.handle('merge:parseFileInfo', async (_, filePath: string) => {
    try {
      // 使用流式解析，写入临时数据库
      const result = await worker.streamParseFileInfo(filePath, (progress: ParseProgress) => {
        // 可选：发送进度到渲染进程
        win.webContents.send('merge:parseProgress', {
          filePath,
          progress,
        })
      })

      // 缓存临时数据库路径（用于后续合并）
      // 这样即使用户删除本地文件，也能继续合并（数据已在临时数据库中）
      if (result.tempDbPath) {
        tempDbCache.set(filePath, result.tempDbPath)
        console.log(`[IpcMain] Cached temp database: ${filePath} -> ${result.tempDbPath}`)
      }

      // 返回基本信息
      return {
        name: result.name,
        format: result.format,
        platform: result.platform,
        messageCount: result.messageCount,
        memberCount: result.memberCount,
        fileSize: result.fileSize,
      }
    } catch (error) {
      console.error('Failed to parse file info:', error)
      throw error
    }
  })

  /**
   * 检测合并冲突（使用临时数据库）
   */
  ipcMain.handle('merge:checkConflicts', async (_, filePaths: string[]) => {
    try {
      return merger.checkConflictsWithTempDb(filePaths, tempDbCache)
    } catch (error) {
      console.error('Failed to detect conflicts:', error)
      throw error
    }
  })

  /**
   * 执行合并（使用临时数据库）
   */
  ipcMain.handle('merge:mergeFiles', async (_, params: MergeParams) => {
    try {
      const result = await merger.mergeFilesWithTempDb(params, tempDbCache)
      // 合并完成后清理缓存
      if (result.success) {
        for (const filePath of params.filePaths) {
          clearTempDbCache(filePath)
        }
      }
      return result
    } catch (error) {
      console.error('Failed to merge:', error)
      return { success: false, error: String(error) }
    }
  })

  /**
   * 清理合并缓存（用于用户移除文件时）
   */
  ipcMain.handle('merge:clearCache', async (_, filePath?: string) => {
    if (filePath) {
      clearTempDbCache(filePath)
    } else {
      cleanupTempDbs()
    }
    return true
  })
}
