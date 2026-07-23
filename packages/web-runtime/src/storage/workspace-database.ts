import type { DatabaseAdapter } from '@openchatlab/core'

export type WorkspaceDatabaseStage =
  | 'opfs-workspace-lock-waiting'
  | 'opfs-workspace-lock-acquired'
  | 'sqlite-initializing'
  | 'sqlite-ready'
  | 'opfs-pool-initializing'
  | 'opfs-pool-ready'
  | 'opfs-pool-resuming'
  | 'opfs-pool-resumed'
  | 'opfs-database-opening'
  | 'opfs-database-opened'
  | 'schema-initializing'
  | 'schema-ready'
  | 'opfs-pool-pausing'
  | 'opfs-pool-paused'
  | 'opfs-workspace-lock-released'

export interface WorkspaceDatabasePort {
  withWorkspaceLease<T>(
    operation: () => Promise<T>,
    onStage?: (stage: WorkspaceDatabaseStage) => void,
    signal?: AbortSignal
  ): Promise<T>
  withDatabase<T>(
    filename: string,
    schemaSql: string,
    operation: (db: DatabaseAdapter) => T,
    onStage?: (stage: WorkspaceDatabaseStage) => void
  ): Promise<T>
  deleteDatabase(filename: string): Promise<boolean>
  ensureCapacity(minimum: number): Promise<number>
  getDatabaseFilenames(): Promise<string[]>
}
