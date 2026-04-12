/**
 * NLP 功能 IPC 处理器
 * 提供词频统计、分词等 NLP 功能，以及词库管理
 */

import { ipcMain } from 'electron'
import * as worker from '../worker/workerManager'
import type { IpcContext } from './types'
import type { WordFrequencyParams, WordFrequencyResult, SupportedLocale, PosTagInfo } from '../nlp'
import { getDictList, downloadDict, deleteDict, isDictDownloaded, type DictInfo } from '../nlp/dictManager'

/**
 * 注册 NLP 相关 IPC 处理器
 */
export function registerNlpHandlers(_ctx: IpcContext): void {
  /**
   * 获取词频统计
   * 用于词云展示
   */
  ipcMain.handle('nlp:getWordFrequency', async (_event, params: WordFrequencyParams): Promise<WordFrequencyResult> => {
    try {
      const result = await worker.query('getWordFrequency', params)
      return result as WordFrequencyResult
    } catch (error) {
      console.error('[NLP] Failed to get word frequency stats:', error)
      return {
        words: [],
        totalWords: 0,
        totalMessages: 0,
        uniqueWords: 0,
      }
    }
  })

  /**
   * 单文本分词
   * 用于调试或其他用途
   */
  ipcMain.handle(
    'nlp:segmentText',
    async (_event, text: string, locale: SupportedLocale, minLength?: number): Promise<string[]> => {
      try {
        const result = await worker.query('segmentText', { text, locale, minLength })
        return result as string[]
      } catch (error) {
        console.error('[NLP] Segmentation failed:', error)
        return []
      }
    }
  )

  /**
   * 获取词性标签定义
   */
  ipcMain.handle('nlp:getPosTags', async (): Promise<PosTagInfo[]> => {
    try {
      const result = await worker.query('getPosTags', {})
      return result as PosTagInfo[]
    } catch (error) {
      console.error('[NLP] Failed to get POS tags:', error)
      return []
    }
  })

  // ==================== 词库管理 ====================

  ipcMain.handle('nlp:getDictList', async (): Promise<DictInfo[]> => {
    return getDictList()
  })

  ipcMain.handle('nlp:isDictDownloaded', async (_event, dictId: string): Promise<boolean> => {
    return isDictDownloaded(dictId)
  })

  ipcMain.handle(
    'nlp:downloadDict',
    async (_event, dictId: string): Promise<{ success: boolean; error?: string }> => {
      return downloadDict(dictId)
    }
  )

  ipcMain.handle('nlp:deleteDict', async (_event, dictId: string): Promise<{ success: boolean; error?: string }> => {
    return deleteDict(dictId)
  })
}
