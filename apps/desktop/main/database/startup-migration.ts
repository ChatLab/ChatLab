import * as fs from 'node:fs'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import type { PathProvider } from '@openchatlab/core'
import { CHAT_DB_COMPATIBILITY_RAISES } from '@openchatlab/node-runtime/src/migrations/chat-db-migrations'
import {
  raiseDataDirMinRuntimeVersion,
  type DataDirCompatibilityMeta,
  type RaiseDataDirCompatibilityInput,
  type RuntimeIdentity,
} from '@openchatlab/node-runtime/src/data-dir-compat'

export interface DesktopStartupMigrationFailure {
  sessionId: string
  error: string
}

export interface DesktopStartupMigrationResult {
  success: boolean
  migratedCount: number
  failures: DesktopStartupMigrationFailure[]
  error?: string
}

export function assertDesktopStartupMigrationSucceeded(result: DesktopStartupMigrationResult): void {
  if (!result.success) {
    throw new Error(formatStartupMigrationError(result))
  }
}

export interface DesktopStartupCompatibilityGateDeps {
  pathProvider: PathProvider
  nativeBinding?: string
  hasCurrentSegmentSchemaData?: () => boolean
  raiseDataDirMinRuntimeVersion?: (
    pathProvider: PathProvider,
    input: RaiseDataDirCompatibilityInput
  ) => DataDirCompatibilityMeta
}

export function repairDesktopStartupCompatibilityGate(
  runtime: RuntimeIdentity,
  deps: DesktopStartupCompatibilityGateDeps
): void {
  const hasCurrentSegmentSchemaData =
    deps.hasCurrentSegmentSchemaData ?? (() => hasCurrentSegmentSchemaDatabases(deps.pathProvider, deps.nativeBinding))
  if (!hasCurrentSegmentSchemaData()) return

  const raise = deps.raiseDataDirMinRuntimeVersion ?? raiseDataDirMinRuntimeVersion
  for (const compatibilityRaise of CHAT_DB_COMPATIBILITY_RAISES) {
    raise(deps.pathProvider, {
      minRuntimeVersion: compatibilityRaise.minRuntimeVersion,
      dataCompatibilityVersion: compatibilityRaise.dataCompatibilityVersion,
      reason: compatibilityRaise.reason,
      runtime,
      module: compatibilityRaise.module,
    })
  }
}

function formatStartupMigrationError(result: DesktopStartupMigrationResult): string {
  const details = result.failures.map((failure) => `${failure.sessionId}: ${failure.error}`).join('\n')
  return ['Database schema migration failed.', result.error, details].filter(Boolean).join('\n')
}

function hasCurrentSegmentSchemaDatabases(pathProvider: PathProvider, nativeBinding?: string): boolean {
  const dbDir = pathProvider.getDatabaseDir()
  if (!fs.existsSync(dbDir)) return false

  for (const file of fs.readdirSync(dbDir)) {
    if (!file.endsWith('.db')) continue

    const dbPath = path.join(dbDir, file)
    let db: Database.Database | null = null
    try {
      db = new Database(dbPath, { readonly: true, nativeBinding })
      if (isCurrentSegmentSchemaDatabase(db)) return true
    } catch (error) {
      console.error(`[Database] Failed to inspect compatibility gate for ${file}:`, error)
    } finally {
      db?.close()
    }
  }

  return false
}

function isCurrentSegmentSchemaDatabase(db: Database.Database): boolean {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('meta', 'message', 'segment', 'message_context')"
    )
    .all() as Array<{ name: string }>
  const tableNames = new Set(tables.map((table) => table.name))
  if (!tableNames.has('meta') || !tableNames.has('message')) return false
  if (!tableNames.has('segment') || !tableNames.has('message_context')) return false

  const metaColumns = db.prepare('PRAGMA table_info(meta)').all() as Array<{ name: string }>
  if (!metaColumns.some((column) => column.name === 'schema_version')) return false

  const version = db.prepare('SELECT schema_version FROM meta LIMIT 1').get() as { schema_version: number } | undefined
  return (version?.schema_version ?? 0) >= 6
}
