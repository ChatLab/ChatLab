/**
 * Incremental import — Electron worker adapter.
 *
 * Thin wrapper around @openchatlab/node-runtime IncrementalImporter.
 * Provides Electron-specific wiring: worker progress IPC, better-sqlite3
 * DB open, and overview cache hook.
 */

import Database from 'better-sqlite3'
import {
  BetterSqliteAdapter,
  analyzeIncrementalImport as sharedAnalyze,
  incrementalImport as sharedImport,
  computeAndSetOverviewCache,
} from '@openchatlab/node-runtime'
import type {
  IncrementalImportDeps,
  IncrementalImportResult,
  IncrementalAnalyzeResult,
  ImportOptions,
} from '@openchatlab/node-runtime'
import { sendProgress, getDbPath } from './utils'
import { getCacheDir } from '../core'
import * as fs from 'fs'

export type { ImportOptions, IncrementalAnalyzeResult, IncrementalImportResult }

function buildDeps(requestId: string): IncrementalImportDeps {
  return {
    openDatabase(sessionId: string, readonly?: boolean) {
      const dbPath = getDbPath(sessionId)
      if (!fs.existsSync(dbPath)) {
        throw new Error(`Session database not found: ${sessionId}`)
      }
      const db = new Database(dbPath, { readonly })
      db.pragma('journal_mode = WAL')
      if (!readonly) db.pragma('synchronous = NORMAL')
      return new BetterSqliteAdapter(db)
    },
    onProgress(progress) {
      sendProgress(requestId, progress)
    },
    postImportHook(_db, sessionId) {
      try {
        const dbPath = getDbPath(sessionId)
        const rawDb = new Database(dbPath)
        computeAndSetOverviewCache(new BetterSqliteAdapter(rawDb), sessionId, getCacheDir())
        rawDb.close()
      } catch {
        /* non-fatal */
      }
    },
  }
}

export async function analyzeIncrementalImport(
  sessionId: string,
  filePath: string,
  requestId: string
): Promise<IncrementalAnalyzeResult> {
  return sharedAnalyze(sessionId, filePath, buildDeps(requestId))
}

export async function incrementalImport(
  sessionId: string,
  filePath: string,
  requestId: string,
  options?: ImportOptions
): Promise<IncrementalImportResult> {
  return sharedImport(sessionId, filePath, buildDeps(requestId), options)
}
