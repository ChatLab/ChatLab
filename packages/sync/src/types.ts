/**
 * @openchatlab/sync — Shared type definitions
 *
 * Platform-agnostic types used by config manager, data source manager,
 * pull engine, and scheduler.
 */

// ==================== API Server Config ====================

export interface ApiServerConfig {
  enabled: boolean
  port: number
  token: string
  createdAt: number
}

// ==================== Data Source / Import Session ====================

export interface ImportSession {
  id: string
  name: string
  remoteSessionId: string
  targetSessionId: string
  lastPullAt: number
  lastStatus: 'idle' | 'success' | 'error'
  lastError: string
  lastNewMessages: number
}

export interface DataSource {
  id: string
  name: string
  baseUrl: string
  token: string
  intervalMinutes: number
  pullLimit: number
  enabled: boolean
  createdAt: number
  sessions: ImportSession[]
}

export type DataSourceUpdatable = Partial<
  Pick<DataSource, 'name' | 'baseUrl' | 'token' | 'intervalMinutes' | 'pullLimit' | 'enabled'>
>

// ==================== Remote Discovery ====================

export interface RemoteSession {
  id: string
  name: string
  platform: string
  type: string
  messageCount?: number
  memberCount?: number
  lastMessageAt?: number
}

export interface RemoteSessionDiscoveryPage {
  hasMore: boolean
  nextCursor?: string
}

export interface RemoteSessionDiscoveryResult {
  sessions: RemoteSession[]
  page?: RemoteSessionDiscoveryPage
}

export interface RemoteSessionDiscoveryQuery {
  keyword?: string
  limit?: number
  cursor?: string
}

// ==================== Pull Engine Abstractions ====================

export interface FetchParams {
  since?: number
  offset?: number
  end?: number
  limit?: number
}

export interface SyncMeta {
  hasMore: boolean
  nextSince?: number
  nextOffset?: number
  watermark?: number
}

export interface ImportResult {
  success: boolean
  newMessageCount: number
  sessionId?: string
  error?: string
  needFullResync?: boolean
}

export interface PullSessionResult {
  success: boolean
  newMessageCount: number
  error?: string
}

export interface PullProgress {
  sessionId: string
  sessionName: string
  current: number
  pages: number
  done: boolean
}

/**
 * Downloads remote data to a temporary file.
 * Platform implementations: Electron uses `net.request`, Node.js uses `fetch`.
 */
export interface HttpFetcher {
  fetchToTempFile(baseUrl: string, remoteSessionId: string, token: string, params: FetchParams): Promise<string>
}

/**
 * Imports a downloaded temp file into a local session database.
 * Platform implementations: Electron uses worker IPC, Server uses DatabaseManager.
 */
export interface DataImporter {
  /**
   * Import temp file into an existing or new local session.
   * If `targetSessionId` is provided, attempt incremental import.
   * Otherwise, create a new session (using `externalId` for deterministic naming).
   */
  importFile(tempFile: string, targetSessionId: string | undefined, externalId: string): Promise<ImportResult>

  /** Check if a local session database exists */
  sessionExists(sessionId: string): boolean
}

/**
 * Notifies the UI about sync events.
 * Electron uses BrowserWindow.webContents.send, Server can use SSE or noop.
 */
export interface SyncNotifier {
  onSessionListChanged(): void
  onPullResult(sourceId: string, sessionId: string | undefined, status: 'success' | 'error', detail: string): void
}

export interface SyncLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string, err?: unknown): void
}

const noop = () => {}

export const NOOP_LOGGER: SyncLogger = { info: noop, warn: noop, error: noop }
