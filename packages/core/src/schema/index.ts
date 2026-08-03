export { CURRENT_SCHEMA_VERSION, CHAT_DB_TABLES, CHAT_DB_INDEXES, CHAT_DB_SCHEMA } from './tables'
export { getSchemaVersion, setSchemaVersion, needsMigration, runMigrations } from './migrations'
export type { Migration } from './migrations'
