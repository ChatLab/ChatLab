import type { PathProvider } from '@openchatlab/core'
import type { DatabaseManager, RuntimeIdentity, SessionRuntimeAdapter } from '@openchatlab/node-runtime'

/** Required runtime capabilities shared by REST and Web route groups. */
export interface RuntimeRouteContext {
  dbManager: DatabaseManager
  sessionAdapter: SessionRuntimeAdapter
  pathProvider: PathProvider
  getVersion: () => string

  runtimeIdentity?: RuntimeIdentity
  /** Native binding path for better-sqlite3 (CLI native copy / Electron-ABI desktop copy). */
  nativeBinding?: string
}
