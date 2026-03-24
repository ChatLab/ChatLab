/**
 * Database connection management for MCP Server
 * Provides read-only SQLite access to ChatLab databases
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// Database directory
let DB_DIR: string = ''

// Connection cache
const dbCache = new Map<string, Database.Database>()

/**
 * Initialize the database directory
 */
export function initDbDir(dir: string): void {
  DB_DIR = dir
}

/**
 * Get the database directory
 */
export function getDbDir(): string {
  return DB_DIR
}

/**
 * Get the database file path for a session
 */
export function getDbPath(sessionId: string): string {
  return path.join(DB_DIR, `${sessionId}.db`)
}

/**
 * Open a database connection (read-only, cached)
 */
export function openDatabase(sessionId: string): Database.Database | null {
  if (dbCache.has(sessionId)) {
    return dbCache.get(sessionId)!
  }

  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) {
    return null
  }

  const db = new Database(dbPath, { readonly: true })
  db.pragma('journal_mode = WAL')

  dbCache.set(sessionId, db)
  return db
}

/**
 * Close a specific database connection
 */
export function closeDatabase(sessionId: string): void {
  const db = dbCache.get(sessionId)
  if (db) {
    db.close()
    dbCache.delete(sessionId)
  }
}

/**
 * Close all database connections
 */
export function closeAllDatabases(): void {
  for (const [sessionId, db] of dbCache.entries()) {
    db.close()
    dbCache.delete(sessionId)
  }
}

/**
 * Session metadata from the meta table
 */
export interface SessionInfo {
  sessionId: string
  name: string
  platform: string
  type: string
  importedAt: number
  messageCount: number
  memberCount: number
  timeRange: { start: number; end: number } | null
}

/**
 * List all available chat sessions by scanning the database directory
 */
export function listSessions(): SessionInfo[] {
  if (!DB_DIR || !fs.existsSync(DB_DIR)) {
    return []
  }

  const files = fs.readdirSync(DB_DIR).filter((f) => f.endsWith('.db'))
  const sessions: SessionInfo[] = []

  for (const file of files) {
    const sessionId = file.replace('.db', '')
    try {
      const db = openDatabase(sessionId)
      if (!db) continue

      // Read meta
      const meta = db.prepare('SELECT name, platform, type, imported_at FROM meta LIMIT 1').get() as {
        name: string
        platform: string
        type: string
        imported_at: number
      } | undefined

      if (!meta) continue

      // Get message count
      const msgCount = db.prepare('SELECT COUNT(*) as count FROM message').get() as { count: number }

      // Get member count
      const memberCount = db.prepare('SELECT COUNT(*) as count FROM member').get() as { count: number }

      // Get time range
      const timeRange = db.prepare('SELECT MIN(ts) as start, MAX(ts) as end FROM message').get() as {
        start: number | null
        end: number | null
      }

      sessions.push({
        sessionId,
        name: meta.name,
        platform: meta.platform,
        type: meta.type,
        importedAt: meta.imported_at,
        messageCount: msgCount.count,
        memberCount: memberCount.count,
        timeRange: timeRange.start !== null && timeRange.end !== null
          ? { start: timeRange.start, end: timeRange.end }
          : null,
      })
    } catch {
      // Skip invalid databases
      continue
    }
  }

  return sessions
}

/**
 * Resolve the default ChatLab database directory based on platform
 */
export function getDefaultDbDir(): string {
  const platform = os.platform()

  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'ChatLab', 'data', 'databases')
  } else if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(appData, 'ChatLab', 'data', 'databases')
  } else {
    // Linux and others
    return path.join(os.homedir(), '.config', 'ChatLab', 'data', 'databases')
  }
}
