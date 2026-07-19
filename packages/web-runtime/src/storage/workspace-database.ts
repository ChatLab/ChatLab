import type { DatabaseAdapter } from '@openchatlab/core'

export type WorkspaceDatabaseStage =
  | 'sqlite-initializing'
  | 'sqlite-ready'
  | 'opfs-pool-initializing'
  | 'opfs-pool-ready'
  | 'opfs-database-opening'
  | 'opfs-database-opened'
  | 'schema-initializing'
  | 'schema-ready'

export interface WorkspaceDatabasePort {
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
