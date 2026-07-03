/**
 * SQL Lab query module — Electron adapter.
 *
 * Delegates to @openchatlab/core's unified executeSql and getSchemaDetailed.
 * Keeps the legacy SQLResult shape for backward-compatible IPC responses.
 */

import { executeSql, getSchemaDetailed } from '@openchatlab/core'
import type { TableSchema } from '@openchatlab/core'
import { openDatabaseAdapter } from '../core'

export type { TableSchema }

export interface SQLResult {
  columns: string[]
  rows: unknown[][]
  rowCount: number
  duration: number
  limited: boolean
}

function ensureAdapter(sessionId: string) {
  const adapter = openDatabaseAdapter(sessionId)
  if (!adapter) throw new Error('Database not found')
  return adapter
}

export function getSchema(sessionId: string): TableSchema[] {
  return getSchemaDetailed(ensureAdapter(sessionId))
}

/**
 * Plugin-style parameterized readonly query.
 * Uses stmt.readonly via the adapter for safety.
 */
export function executePluginQuery<T = Record<string, unknown>>(
  sessionId: string,
  sql: string,
  params: unknown[] | Record<string, unknown> = []
): T[] {
  const adapter = ensureAdapter(sessionId)
  const stmt = adapter.prepare(sql.trim())

  if (stmt.readonly === false) {
    throw new Error('Plugin Security Violation: Only READ-ONLY statements are allowed.')
  }

  if (Array.isArray(params)) {
    return stmt.all(...params) as T[]
  }
  return stmt.all(params) as T[]
}

/**
 * Execute user SQL (SQL Lab).
 * Returns columnar format with timing for the legacy IPC contract.
 */
export function executeRawSQL(sessionId: string, sql: string, maxRows: number = 0): SQLResult {
  const adapter = ensureAdapter(sessionId)

  try {
    const result = executeSql(adapter, sql, { columnar: true, timing: true, maxRows })
    return {
      columns: result.columns,
      rows: result.rows as unknown[][],
      rowCount: result.rowCount,
      duration: result.duration ?? 0,
      limited: result.truncated,
    }
  } catch (error) {
    if (error instanceof Error) {
      const message = error.message.replace(/^SQLITE_ERROR: /, '').replace(/^SQLITE_READONLY: /, '')
      throw new Error(message)
    }
    throw error
  }
}
