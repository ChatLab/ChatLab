import type {
  FilterResultWithPagination,
  ExportFilterParams,
  ExportProgress,
  ToolCatalogEntry,
  ToolExecuteResult,
  DesensitizeRule,
} from './types'
import type { TimeFilter } from '@/types/base'
import { FetchAIAdapter } from './fetch'

/**
 * Electron AI Adapter
 *
 * Extends FetchAIAdapter so conversation/message CRUD and debug queries
 * go through the Internal HTTP Server (shared routes). Only features
 * that require IPC (worker, native shell, tool registry) are overridden.
 */
export class ElectronAIAdapter extends FetchAIAdapter {
  // ===== Context estimation (needs conversationManager on main process) =====
  override async estimateContextTokens(
    conversationId: string
  ): Promise<{ success: boolean; tokens: number; messageCount?: number; error?: string }> {
    return window.aiApi.estimateContextTokens(conversationId)
  }

  // ===== Message filtering / export (worker-dependent) =====
  override async filterMessagesWithContext(
    sessionId: string,
    keywords?: string[],
    timeFilter?: TimeFilter,
    senderIds?: number[],
    contextSize?: number,
    page?: number,
    pageSize?: number
  ): Promise<FilterResultWithPagination> {
    return window.aiApi.filterMessagesWithContext(
      sessionId,
      keywords,
      timeFilter,
      senderIds,
      contextSize,
      page,
      pageSize
    )
  }

  override async getMultipleSessionsMessages(
    sessionId: string,
    chatSessionIds: number[],
    page?: number,
    pageSize?: number
  ): Promise<FilterResultWithPagination> {
    return window.aiApi.getMultipleSessionsMessages(sessionId, chatSessionIds, page, pageSize)
  }

  override async exportFilterResultToFile(
    params: ExportFilterParams
  ): Promise<{ success: boolean; filePath?: string; error?: string }> {
    return window.aiApi.exportFilterResultToFile(params)
  }

  override onExportProgress(callback: (progress: ExportProgress) => void): () => void {
    return window.aiApi.onExportProgress(callback)
  }

  // ===== Tool testing (localized catalog + worker execution on main process) =====
  override async getToolCatalog(): Promise<ToolCatalogEntry[]> {
    return window.aiApi.getToolCatalog()
  }

  override async executeTool(
    testId: string,
    toolName: string,
    params: Record<string, unknown>,
    sessionId: string
  ): Promise<ToolExecuteResult> {
    return window.aiApi.executeTool(testId, toolName, params, sessionId)
  }

  override async cancelToolTest(testId: string): Promise<{ success: boolean }> {
    return window.aiApi.cancelToolTest(testId)
  }

  // ===== Desensitize rules (needs node-runtime) =====
  override async getDefaultDesensitizeRules(locale: string): Promise<DesensitizeRule[]> {
    return window.aiApi.getDefaultDesensitizeRules(locale)
  }

  override async mergeDesensitizeRules(existingRules: DesensitizeRule[], locale: string): Promise<DesensitizeRule[]> {
    return window.aiApi.mergeDesensitizeRules(existingRules, locale)
  }

  // ===== Native shell =====
  override async showAiLogFile(): Promise<{ success: boolean; path?: string; error?: string }> {
    return window.aiApi.showAiLogFile()
  }
}
