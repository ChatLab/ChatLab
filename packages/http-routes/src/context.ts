/**
 * HttpRouteContext — shared dependency injection interface for route handlers.
 *
 * CLI Server and Electron Internal Server each construct their own context
 * and pass it to registerSharedRoutes(). Route handlers only depend on this
 * interface, never on CLI or Electron specific modules.
 */

import type { PathProvider } from '@openchatlab/core'
import type { DatabaseManager, SessionRuntimeAdapter, PreferencesManager } from '@openchatlab/node-runtime'

export interface HttpRouteContext {
  dbManager: DatabaseManager
  sessionAdapter: SessionRuntimeAdapter
  pathProvider: PathProvider

  getVersion: () => string

  /** Reserved for future migrated routes (import/merge) that need the native binding path */
  nativeBinding?: string

  preferencesManager?: PreferencesManager
}
