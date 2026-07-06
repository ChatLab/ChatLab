/**
 * Incremental import — Electron worker adapter.
 *
 * Thin wrapper around @openchatlab/node-runtime IncrementalImporter.
 * Provides Electron-specific wiring: worker progress IPC, better-sqlite3
 * DB open, and overview cache hook.
 */

import * as path from 'path'
import {
  BetterSqliteAdapter,
  analyzeIncrementalImport as sharedAnalyze,
  incrementalImport as sharedImport,
  computeAndSetOverviewCache,
  deleteSessionCache,
} from '@openchatlab/node-runtime'
import type {
  IncrementalImportDeps,
  IncrementalImportResult,
  IncrementalAnalyzeResult,
  ImportOptions,
} from '@openchatlab/node-runtime'
import { sendProgress, getDbPath } from './utils'
import { getCacheDir, openRawDatabase } from '../core'
import * as fs from 'fs'

export type { ImportOptions, IncrementalAnalyzeResult, IncrementalImportResult }

function buildDeps(requestId: string): IncrementalImportDeps {
  return {
    openDatabase(sessionId: string, readonly?: boolean) {
      const dbPath = getDbPath(sessionId)
      if (!fs.existsSync(dbPath)) {
        throw new Error(`Session database not found: ${sessionId}`)
      }
      const db = openRawDatabase(dbPath, { readonly })
      if (!readonly) db.pragma('synchronous = NORMAL')
      return new BetterSqliteAdapter(db)
    },
    onProgress(progress) {
      sendProgress(requestId, progress)
    },
    postImportHook(_db, sessionId) {
      const cacheDir = getCacheDir()
      try {
        const rawDb = openRawDatabase(getDbPath(sessionId))
        computeAndSetOverviewCache(new BetterSqliteAdapter(rawDb), sessionId, cacheDir)
        rawDb.close()
      } catch (err) {
        // Non-fatal: getValidatedOverviewCache will recompute on next read.
        console.warn('[Worker] postImportHook: failed to refresh overview cache', err)
      }
      if (cacheDir) {
        deleteSessionCache(sessionId, path.join(cacheDir, 'query'))
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
