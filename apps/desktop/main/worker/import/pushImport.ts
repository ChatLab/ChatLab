import * as fs from 'node:fs'
import * as path from 'node:path'
import { BetterSqliteAdapter } from '@openchatlab/node-runtime/src/better-sqlite3-adapter'
import { computeAndSetOverviewCache, deleteSessionCache } from '@openchatlab/node-runtime/src/cache/session-cache'
import {
  executePushImportUnlocked,
  type PushImportOutcome,
  type PushImportPayload,
} from '@openchatlab/node-runtime/src/services/push-importer'
import { closeDatabase, getCacheDir, getDbDir, openRawDatabase } from '../core/dbCore'

function getDbPath(sessionId: string): string {
  return path.join(getDbDir(), `${sessionId}.db`)
}

function refreshImportCaches(sessionId: string): void {
  const cacheDir = getCacheDir()
  try {
    const rawDb = openRawDatabase(getDbPath(sessionId))
    try {
      computeAndSetOverviewCache(new BetterSqliteAdapter(rawDb), sessionId, cacheDir)
    } finally {
      rawDb.close()
    }
  } catch (error) {
    // Cache refresh is best-effort and must not turn a successful import into a failure.
    console.warn('[Worker] pushImport: failed to refresh overview cache', error)
  }

  if (cacheDir) {
    deleteSessionCache(sessionId, path.join(cacheDir, 'query'))
  }
}

export async function pushImport(sessionId: string, payload: PushImportPayload): Promise<PushImportOutcome> {
  const outcome = await executePushImportUnlocked(
    {
      getDbPath,
      openDatabase(id, options) {
        const dbPath = getDbPath(id)
        if (!options.create && !fs.existsSync(dbPath)) throw new Error(`Session database not found: ${id}`)
        closeDatabase(id)
        fs.mkdirSync(path.dirname(dbPath), { recursive: true })
        const db = options.readonly === undefined ? openRawDatabase(dbPath) : openRawDatabase(dbPath, options)
        return new BetterSqliteAdapter(db)
      },
      deleteDatabase(id) {
        closeDatabase(id)
        const dbPath = getDbPath(id)
        for (const suffix of ['', '-wal', '-shm']) {
          try {
            const filePath = dbPath + suffix
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
          } catch {
            /* best-effort cleanup */
          }
        }
      },
    },
    sessionId,
    payload
  )

  if (outcome.ok) refreshImportCaches(sessionId)
  return outcome
}
