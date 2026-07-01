import type { ExportFilterParams, ExportProgress } from './types'
import { FetchAIAdapter } from './fetch'

/**
 * Electron AI Adapter
 *
 * Extends FetchAIAdapter so most queries go through the Internal HTTP Server
 * (shared routes). Only filesystem export with progress push still requires
 * IPC; native shell operations are exposed by shared HTTP routes.
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
}
