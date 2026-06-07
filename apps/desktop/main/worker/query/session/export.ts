/**
 * Export module — Electron worker adapter.
 *
 * Thin wrapper around @openchatlab/node-runtime markdown exporter.
 * Provides Electron-specific wiring: worker progress IPC, filesystem output,
 * and readonly better-sqlite3 database opening.
 */

import * as fs from 'fs'
import * as path from 'path'
import { parentPort } from 'worker_threads'
import { BetterSqliteAdapter } from '@openchatlab/node-runtime'
import { exportFilterResultToMarkdown } from '@openchatlab/node-runtime'
import type { ExportProgress } from '@openchatlab/node-runtime'
import { openReadonlyDatabase } from './core'
import type { ExportFilterParams } from './types'

export type { ExportFilterParams, ExportProgress } from './types'

function sendExportProgress(requestId: string, progress: ExportProgress): void {
  parentPort?.postMessage({
    id: requestId,
    type: 'progress',
    payload: progress,
  })
}

/**
 * Export filter results to a Markdown file on disk.
 * Delegates to shared engine; provides fs.createWriteStream as the ExportWriter.
 */
export function exportFilterResultToFile(
  params: ExportFilterParams,
  requestId?: string
): { success: boolean; filePath?: string; error?: string } {
  const timestamp = Date.now()
  const fileName = `${params.sessionName}_筛选结果_${timestamp}.md`
  const filePath = path.join(params.outputDir, fileName)

  const writeStream = fs.createWriteStream(filePath, { encoding: 'utf8' })

  const result = exportFilterResultToMarkdown(
    {
      sessionId: params.sessionId,
      sessionName: params.sessionName,
      filterMode: params.filterMode,
      keywords: params.keywords,
      timeFilter: params.timeFilter,
      senderIds: params.senderIds,
      contextSize: params.contextSize,
      segmentIds: params.segmentIds,
    },
    {
      openDatabase(sessionId: string) {
        const rawDb = openReadonlyDatabase(sessionId)
        if (!rawDb) return null
        return new BetterSqliteAdapter(rawDb)
      },
      onProgress: requestId ? (progress) => sendExportProgress(requestId, progress) : undefined,
    },
    {
      write(chunk: string) {
        writeStream.write(chunk)
      },
      end() {
        writeStream.end()
      },
    }
  )

  if (result.success) {
    return { success: true, filePath }
  }
  return { success: false, error: result.error }
}
