import type { DatabaseAdapter } from '@openchatlab/core'
import { WebRuntimeError } from '../runtime-error'
import type { WorkspaceDatabasePort, WorkspaceDatabaseStage } from '../storage/workspace-database'
import { sessionDatabaseFilename } from './session-paths'

export const WEB_SESSION_CATALOG_FILENAME = '/chatlab-session-catalog.db'

const CATALOG_SCHEMA = `
  CREATE TABLE IF NOT EXISTS session_catalog (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    type TEXT NOT NULL,
    imported_at INTEGER NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0,
    member_count INTEGER NOT NULL DEFAULT 0,
    group_id TEXT,
    group_avatar TEXT,
    owner_id TEXT,
    last_message_ts INTEGER,
    format_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('importing', 'ready'))
  );
  CREATE INDEX IF NOT EXISTS idx_session_catalog_status ON session_catalog(status);
  CREATE INDEX IF NOT EXISTS idx_session_catalog_last_message ON session_catalog(last_message_ts DESC);
`

export interface BrowserSessionCatalogItem {
  id: string
  name: string
  platform: string
  type: string
  importedAt: number
  messageCount: number
  memberCount: number
  groupId: string | null
  groupAvatar: string | null
  ownerId: string | null
  lastMessageTs: number | null
  formatId: string
}

interface CatalogRow {
  id: string
  name: string
  platform: string
  type: string
  imported_at: number
  message_count: number
  member_count: number
  group_id: string | null
  group_avatar: string | null
  owner_id: string | null
  last_message_ts: number | null
  format_id: string
  status: 'importing' | 'ready'
}

export class BrowserSessionCatalog {
  constructor(private readonly database: WorkspaceDatabasePort) {}

  async beginImport(item: BrowserSessionCatalogItem): Promise<void> {
    await this.withCatalog((db) => {
      db.prepare(
        `INSERT INTO session_catalog (
          id, name, platform, type, imported_at, message_count, member_count,
          group_id, group_avatar, owner_id, last_message_ts, format_id, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'importing')`
      ).run(
        item.id,
        item.name,
        item.platform,
        item.type,
        item.importedAt,
        item.messageCount,
        item.memberCount,
        item.groupId,
        item.groupAvatar,
        item.ownerId,
        item.lastMessageTs,
        item.formatId
      )
    })
  }

  async completeImport(id: string, counts: { messageCount: number; memberCount: number }): Promise<void> {
    await this.withCatalog((db) => {
      const result = db
        .prepare(
          `UPDATE session_catalog
           SET status = 'ready', message_count = ?, member_count = ?
           WHERE id = ? AND status = 'importing'`
        )
        .run(counts.messageCount, counts.memberCount, id)
      if (result.changes !== 1) {
        throw new WebRuntimeError('CATALOG_IMPORT_MISSING', `Catalog import ${id} could not be completed`)
      }
    })
  }

  async abortImport(id: string): Promise<void> {
    await this.deleteRow(id)
  }

  async list(onStage?: (stage: WorkspaceDatabaseStage) => void): Promise<BrowserSessionCatalogItem[]> {
    await this.cleanupInterruptedImports(onStage)
    const rows = (await this.withCatalog((db) =>
      db
        .prepare(
          `SELECT * FROM session_catalog
           WHERE status = 'ready'
           ORDER BY last_message_ts DESC, imported_at DESC, id DESC`
        )
        .all()
    )) as unknown as CatalogRow[]
    return this.removeMissingDatabases(rows)
  }

  async get(id: string): Promise<BrowserSessionCatalogItem | null> {
    await this.cleanupInterruptedImports()
    const row = (await this.withCatalog((db) =>
      db.prepare("SELECT * FROM session_catalog WHERE id = ? AND status = 'ready'").get(id)
    )) as CatalogRow | undefined
    if (!row) return null

    const filenames = new Set(await this.database.getDatabaseFilenames())
    if (!filenames.has(sessionDatabaseFilename(id))) {
      await this.deleteRow(id)
      return null
    }
    return mapCatalogRow(row)
  }

  async rename(id: string, name: string): Promise<boolean> {
    return this.withCatalog(
      (db) =>
        db.prepare("UPDATE session_catalog SET name = ? WHERE id = ? AND status = 'ready'").run(name, id).changes > 0
    )
  }

  async deleteRow(id: string): Promise<boolean> {
    return this.withCatalog((db) => db.prepare('DELETE FROM session_catalog WHERE id = ?').run(id).changes > 0)
  }

  async count(): Promise<number> {
    const row = (await this.withCatalog((db) => db.prepare('SELECT COUNT(*) AS count FROM session_catalog').get())) as {
      count: number
    }
    return row.count
  }

  private async cleanupInterruptedImports(onStage?: (stage: WorkspaceDatabaseStage) => void): Promise<void> {
    const rows = (await this.withCatalog(
      (db) => db.prepare("SELECT id FROM session_catalog WHERE status = 'importing'").all(),
      onStage
    )) as Array<{ id: string }>

    for (const row of rows) {
      await this.database.deleteDatabase(sessionDatabaseFilename(row.id))
      await this.deleteRow(row.id)
    }
  }

  private async removeMissingDatabases(rows: CatalogRow[]): Promise<BrowserSessionCatalogItem[]> {
    const filenames = new Set(await this.database.getDatabaseFilenames())
    const result: BrowserSessionCatalogItem[] = []
    for (const row of rows) {
      if (!filenames.has(sessionDatabaseFilename(row.id))) {
        await this.deleteRow(row.id)
        continue
      }
      result.push(mapCatalogRow(row))
    }
    return result
  }

  private withCatalog<T>(
    operation: (db: DatabaseAdapter) => T,
    onStage?: (stage: WorkspaceDatabaseStage) => void
  ): Promise<T> {
    return this.database.withDatabase(WEB_SESSION_CATALOG_FILENAME, CATALOG_SCHEMA, operation, onStage)
  }
}

function mapCatalogRow(row: CatalogRow): BrowserSessionCatalogItem {
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    type: row.type,
    importedAt: row.imported_at,
    messageCount: row.message_count,
    memberCount: row.member_count,
    groupId: row.group_id,
    groupAvatar: row.group_avatar,
    ownerId: row.owner_id,
    lastMessageTs: row.last_message_ts,
    formatId: row.format_id,
  }
}
