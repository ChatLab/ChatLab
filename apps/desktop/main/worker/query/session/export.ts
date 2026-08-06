/**
 * Export module — Electron worker adapter.
 *
 * Uses @openchatlab/node-runtime format exporter for multi-format output.
 * Provides Electron-specific wiring: filesystem write and readonly DB opening.
 */

import * as fs from 'fs'
import * as path from 'path'
import type { DatabaseAdapter } from '@openchatlab/core'
import { BetterSqliteAdapter } from '@openchatlab/node-runtime/src/better-sqlite3-adapter'
import { exportWithFormat, type ExportFormat } from '@openchatlab/node-runtime/src/export/format-exporter'
import { openReadonlyDatabase } from './core'

function openExportDatabase(sessionId: string): DatabaseAdapter | null {
  const rawDb = openReadonlyDatabase(sessionId)
  return rawDb ? new BetterSqliteAdapter(rawDb) : null
}

export function exportFilterResultToFile(
  params: {
    sessionId: string
    sessionName: string
    outputDir: string
    format?: ExportFormat
    timeFilter?: { startTs: number; endTs: number }
  },
  openDatabase: (sessionId: string) => DatabaseAdapter | null = openExportDatabase
): {
  success: boolean
  filePath?: string
  error?: string
} {
  const format: ExportFormat = params.format || 'txt'
  const openedDatabase = openDatabase(params.sessionId)

  try {
    const result = exportWithFormat(
      {
        sessionId: params.sessionId,
        sessionName: params.sessionName,
        format,
        timeFilter: params.timeFilter,
      },
      () => openedDatabase
    )

    if (!result.success) {
      return { success: false, error: result.error }
    }

    const filePath = path.join(params.outputDir, result.filename)
    fs.writeFileSync(filePath, result.content, 'utf8')
    return { success: true, filePath }
  } finally {
    openedDatabase?.close()
  }
}
