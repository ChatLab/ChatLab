import sqlite3InitModule, { type SAHPoolUtil, type Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import { WebRuntimeError } from '../runtime-error'

export const WEB_RUNTIME_SAHPOOL_DIRECTORY = '/chatlab-web-runtime-sahpool'

export interface InitializedSqliteRuntime {
  sqlite3: Sqlite3Static
  pool: SAHPoolUtil
}

export type SqliteInitializationStage =
  | 'sqlite-initializing'
  | 'sqlite-ready'
  | 'opfs-pool-initializing'
  | 'opfs-pool-ready'

type OpfsSahPoolOptions = Parameters<Sqlite3Static['installOpfsSAHPoolVfs']>[0] & {
  forceReinitIfPreviouslyFailed?: boolean
}

export async function initializeOpfsSqlite(
  onStage?: (stage: SqliteInitializationStage) => void
): Promise<InitializedSqliteRuntime> {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') {
    throw new WebRuntimeError('OPFS_UNAVAILABLE', 'Origin private file system is not available in this browser')
  }

  onStage?.('sqlite-initializing')
  const sqlite3 = await sqlite3InitModule()
  onStage?.('sqlite-ready')

  onStage?.('opfs-pool-initializing')
  // sqlite-wasm supports this retry option at runtime, but its published types do not declare it yet.
  const poolOptions: OpfsSahPoolOptions = {
    directory: WEB_RUNTIME_SAHPOOL_DIRECTORY,
    initialCapacity: 8,
    forceReinitIfPreviouslyFailed: true,
  }
  const pool = await sqlite3.installOpfsSAHPoolVfs(poolOptions)
  onStage?.('opfs-pool-ready')

  return { sqlite3, pool }
}
