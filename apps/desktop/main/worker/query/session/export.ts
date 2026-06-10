/**
 * Export module — Electron worker adapter.
 *
 * Uses @openchatlab/node-runtime format exporter for multi-format output.
 * Provides Electron-specific wiring: filesystem write and readonly DB opening.
 */

import * as fs from 'fs'
import * as path from 'path'
import { BetterSqliteAdapter } from '@openchatlab/node-runtime'
import { exportWithFormat } from '@openchatlab/node-runtime'
import type { ExportFormat } from '@openchatlab/node-runtime'
import { openReadonlyDatabase } from './core'

export function exportFilterResultToFile(params: {
  sessionId: string
  sessionName: string
  outputDir: string
  format?: ExportFormat
  timeFilter?: { startTs: number; endTs: number }
}): { success: boolean; filePath?: string; error?: string } {
  const format: ExportFormat = params.format || 'txt'

  const result = exportWithFormat(
    {
      sessionId: params.sessionId,
      sessionName: params.sessionName,
      format,
      timeFilter: params.timeFilter,
    },
    (sessionId) => {
      const rawDb = openReadonlyDatabase(sessionId)
      if (!rawDb) return null
      return new BetterSqliteAdapter(rawDb)
    }
  )

  if (!result.success) {
    return { success: false, error: result.error }
  }

  const filePath = path.join(params.outputDir, result.filename)
  fs.writeFileSync(filePath, result.content, 'utf8')
  return { success: true, filePath }
}
