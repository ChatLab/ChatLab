/**
 * Incremental import — Electron worker adapter.
 *
 * Thin wrapper around @openchatlab/node-runtime IncrementalImporter.
 * Provides Electron-specific wiring: worker progress IPC, better-sqlite3
 * DB open, and overview cache hook.
 */

import * as path from 'path'
import Database from 'better-sqlite3'
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
import { closeDatabase, getCacheDir } from '../core'
import { getUserDataDir } from '../../paths'
import { migrateDatabase } from '../../database/migrations'
import * as fs from 'fs'

export type { ImportOptions, IncrementalAnalyzeResult, IncrementalImportResult }

function buildDeps(requestId: string): IncrementalImportDeps {
  return {
    openDatabase(sessionId: string, readonly?: boolean) {
      const dbPath = getDbPath(sessionId)
      if (!fs.existsSync(dbPath)) {
        throw new Error(`Session database not found: ${sessionId}`)
      }
      if (!readonly) {
        closeDatabase(sessionId)
      }
      const db = new Database(dbPath, { readonly })
      db.pragma('journal_mode = WAL')
      if (!readonly) {
        db.pragma('synchronous = NORMAL')
        migrateDatabase(db)
      }
      return new BetterSqliteAdapter(db)
    },
    onProgress(progress) {
      sendProgress(requestId, progress)
    },
    postImportHook(_db, sessionId) {
      const cacheDir = getCacheDir()
      try {
        const dbPath = getDbPath(sessionId)
        const rawDb = new Database(dbPath)
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
    getSessionMediaDir(sessionId: string) {
      return path.join(getUserDataDir(), 'media', sessionId)
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
