/**
 * AI 相关 API — 仅保留 IPC 必须的能力
 *
 * Conversation/message CRUD 已迁移到 HTTP 共享路由（FetchAIAdapter）。
 * LLM/Agent streaming 已迁移到 SSE 共享路由（useAgentStreamService/useLlmStreamService）。
 * 此处只保留需要 worker、native shell、工具注册表等 IPC 才能提供的功能。
 */
import { ipcRenderer } from 'electron'
import type { ExportProgress } from '../../../../src/types/base'

export type { TokenUsage, AgentRuntimeStatus, SerializedErrorInfo } from '../../shared/types'

// ==================== 类型定义 ====================

export interface DesensitizeRule {
  id: string
  label: string
  pattern: string
  replacement: string
  enabled: boolean
  builtin: boolean
  locales: string[]
}

export interface PreprocessConfig {
  dataCleaning: boolean
  mergeConsecutive: boolean
  mergeWindowSeconds?: number
  blacklistKeywords: string[]
  denoise: boolean
  desensitize: boolean
  desensitizeRules: DesensitizeRule[]
  anonymizeNames: boolean
}

// ==================== AI API (IPC-only subset) ====================

export const aiApi = {
  // filterMessagesWithContext / getMultipleSessionsMessages migrated to shared HTTP routes.

  exportFilterResultToFile: (params: {
    sessionId: string
    sessionName: string
    outputDir: string
    filterMode: 'condition' | 'session'
    keywords?: string[]
    timeFilter?: { startTs: number; endTs: number }
    senderIds?: number[]
    contextSize?: number
    chatSessionIds?: number[]
  }): Promise<{ success: boolean; filePath?: string; error?: string }> => {
    return ipcRenderer.invoke('ai:exportFilterResultToFile', params)
  },

  onExportProgress: (callback: (progress: ExportProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ExportProgress) => {
      callback(progress)
    }
    ipcRenderer.on('ai:exportProgress', handler)
    return () => {
      ipcRenderer.removeListener('ai:exportProgress', handler)
    }
  },

  // ===== 日志（native shell） =====

  showAiLogFile: (): Promise<{ success: boolean; path?: string; error?: string }> => {
    return ipcRenderer.invoke('ai:showLogFile')
  },

  // Desensitize rules, tool testing, estimateContextTokens have been migrated to shared HTTP routes.
}

// LLM chat (non-streaming) IPC has been removed — no frontend consumers remain.
// All LLM calls now go through shared HTTP/SSE routes.
