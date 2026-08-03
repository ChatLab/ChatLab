export { CHAT_DB_COMPATIBILITY_RAISES, getChatDbMigrations, raiseChatDbCompatibilityGate } from './chat-db-migrations'
export type { ChatDbCompatibilityRaise } from './chat-db-migrations'

export { migrateFromElectronIfNeeded, verifyCliDataPath, wasElectronUsed } from './electron-data-migration'
export type { ElectronMigrationResult } from './electron-data-migration'
