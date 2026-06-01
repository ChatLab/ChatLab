import type { ExportFilterParams, ExportProgress } from './types'
import { FetchAIAdapter } from './fetch'

/**
 * Electron AI Adapter
 *
 * Extends FetchAIAdapter so most queries go through the Internal HTTP Server
 * (shared routes). Only features that require IPC (filesystem export with
 * progress push, native shell) are overridden here.
 */
export class ElectronAIAdapter extends FetchAIAdapter {
  override async exportFilterResultToFile(
    params: ExportFilterParams
  ): Promise<{ success: boolean; filePath?: string; error?: string }> {
    return window.aiApi.exportFilterResultToFile(params)
  }

  override onExportProgress(callback: (progress: ExportProgress) => void): () => void {
    return window.aiApi.onExportProgress(callback)
  }

  override async showAiLogFile(): Promise<{ success: boolean; path?: string; error?: string }> {
    return window.aiApi.showAiLogFile()
  }
}
