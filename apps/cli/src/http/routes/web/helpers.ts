/**
 * Shared helpers for web route modules.
 */

import * as fs from 'fs'
import type { DatabaseManager } from '@openchatlab/node-runtime'
import { resolveCliPath } from '../../../paths'

export function resolveNativeBinding(): string | undefined {
  if (process.versions.electron) return undefined
  const nativePath = resolveCliPath('native/better_sqlite3.node')
  if (fs.existsSync(nativePath)) return nativePath
  return undefined
}

export function getAiDataDir(dbManager: DatabaseManager): string {
  const pathProvider = (dbManager as any)['pathProvider']
  if (!pathProvider) {
    throw Object.assign(new Error('PathProvider not available'), { statusCode: 500 })
  }
  return pathProvider.getAiDataDir()
}
