export { getChatDbMigrations } from './chat-db-migrations'
export type { MigrationDeps } from './chat-db-migrations'

export { migrateFromElectronIfNeeded, verifyCliDataPath, wasElectronUsed } from './electron-data-migration'
export type { ElectronMigrationResult } from './electron-data-migration'
