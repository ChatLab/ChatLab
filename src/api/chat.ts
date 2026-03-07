/**
 * Chat session API client — replaces window.chatApi
 *
 * Maps preload IPC calls to HTTP endpoints under /api/sessions and /api/import.
 */

import { get, post, put, del, patch, upload } from './client'
import type { AnalysisSession, MessageType, ImportProgress } from '@/types/base'
import type {
  MemberActivity,
  MemberNameHistory,
  HourlyActivity,
  DailyActivity,
  WeekdayActivity,
  MonthlyActivity,
  CatchphraseAnalysis,
  MentionAnalysis,
  LaughAnalysis,
  MemberWithStats,
  ClusterGraphData,
  ClusterGraphOptions,
} from '@/types/analysis'

// ─────────────────────────── helper types ───────────────────────────

interface TimeFilter {
  startTs?: number
  endTs?: number
}

interface PaginationParams {
  page: number
  pageSize: number
  search?: string
  sortOrder?: 'asc' | 'desc'
}

interface PaginatedMembers {
  members: MemberWithStats[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

interface MentionGraphData {
  nodes: Array<{ id: number; name: string; value: number; symbolSize: number }>
  links: Array<{ source: string; target: string; value: number }>
  maxLinkValue: number
}

interface SQLResult {
  columns: string[]
  rows: unknown[][]
  rowCount: number
  duration: number
  limited: boolean
}

interface TableSchema {
  name: string
  columns: Array<{ name: string; type: string; notnull: boolean; pk: boolean }>
}

// ─────────────────────────── helpers ───────────────────────────

function filterQuery(filter?: TimeFilter): Record<string, unknown> {
  const q: Record<string, unknown> = {}
  if (filter?.startTs !== undefined) q.startTs = filter.startTs
  if (filter?.endTs !== undefined) q.endTs = filter.endTs
  return q
}

// ─────────────────────────── chatApi ───────────────────────────

export const chatApi = {
  // ── Migration ──

  checkMigration: () =>
    get<{
      needsMigration: boolean
      count: number
      currentVersion: number
      pendingMigrations: Array<{ version: number; userMessage: string }>
    }>('/migration/check'),

  runMigration: () =>
    post<{ success: boolean; migratedCount: number; error?: string }>('/migration/run'),

  // ── File import ──

  /**
   * Upload and import a chat file. Uses FormData instead of a local file path.
   */
  import: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return upload<{ success: boolean; sessionId?: string; error?: string }>('/import', fd)
  },

  /**
   * Detect the format of an uploaded file.
   */
  detectFormat: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return upload<{ id: string; name: string; platform: string; multiChat: boolean } | null>(
      '/import/detect-format',
      fd,
    )
  },

  /**
   * Import with format options (e.g. chatIndex for multi-chat files).
   */
  importWithOptions: (file: File, formatOptions: Record<string, unknown>) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('options', JSON.stringify(formatOptions))
    return upload<{ success: boolean; sessionId?: string; error?: string }>('/import/with-options', fd)
  },

  /**
   * Scan multi-chat file for available chats.
   */
  scanMultiChatFile: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return upload<{
      success: boolean
      chats: Array<{ index: number; name: string; type: string; id: number; messageCount: number }>
      error?: string
    }>('/import/scan-multi-chat', fd)
  },

  // ── Sessions ──

  getSessions: () => get<AnalysisSession[]>('/sessions'),

  getSession: (sessionId: string) => get<AnalysisSession | null>(`/sessions/${sessionId}`),

  deleteSession: (sessionId: string) =>
    del<{ success: boolean }>(`/sessions/${sessionId}`).then((r) => r.success ?? true),

  renameSession: (sessionId: string, newName: string) =>
    patch<{ success: boolean }>(`/sessions/${sessionId}`, { name: newName }).then((r) => r.success ?? true),

  updateSessionOwnerId: (sessionId: string, ownerId: string | null) =>
    patch<{ success: boolean }>(`/sessions/${sessionId}`, { ownerId }).then((r) => r.success ?? true),

  // ── Analysis data ──

  getAvailableYears: (sessionId: string) =>
    get<number[]>(`/sessions/${sessionId}/years`),

  getMemberActivity: (sessionId: string, filter?: TimeFilter) =>
    get<MemberActivity[]>(`/sessions/${sessionId}/member-activity`, filterQuery(filter)),

  getMemberNameHistory: (sessionId: string, memberId: number) =>
    get<MemberNameHistory[]>(`/sessions/${sessionId}/member-name-history/${memberId}`),

  getHourlyActivity: (sessionId: string, filter?: TimeFilter) =>
    get<HourlyActivity[]>(`/sessions/${sessionId}/hourly-activity`, filterQuery(filter)),

  getDailyActivity: (sessionId: string, filter?: TimeFilter) =>
    get<DailyActivity[]>(`/sessions/${sessionId}/daily-activity`, filterQuery(filter)),

  getWeekdayActivity: (sessionId: string, filter?: TimeFilter) =>
    get<WeekdayActivity[]>(`/sessions/${sessionId}/weekday-activity`, filterQuery(filter)),

  getMonthlyActivity: (sessionId: string, filter?: TimeFilter) =>
    get<MonthlyActivity[]>(`/sessions/${sessionId}/monthly-activity`, filterQuery(filter)),

  getYearlyActivity: (sessionId: string, filter?: TimeFilter) =>
    get<Array<{ year: number; messageCount: number }>>(`/sessions/${sessionId}/yearly-activity`, filterQuery(filter)),

  getMessageLengthDistribution: (sessionId: string, filter?: TimeFilter) =>
    get<{
      detail: Array<{ len: number; count: number }>
      grouped: Array<{ range: string; count: number }>
    }>(`/sessions/${sessionId}/message-length-distribution`, filterQuery(filter)),

  getMessageTypeDistribution: (sessionId: string, filter?: TimeFilter) =>
    get<Array<{ type: MessageType; count: number }>>(`/sessions/${sessionId}/message-type-distribution`, filterQuery(filter)),

  getTimeRange: (sessionId: string) =>
    get<{ start: number; end: number } | null>(`/sessions/${sessionId}/time-range`),

  getDbDirectory: () =>
    get<{ path: string }>('/cache/data-dir').then((r) => r.path),

  getSupportedFormats: () =>
    get<Array<{ name: string; platform: string }>>('/import/formats'),

  getCatchphraseAnalysis: (sessionId: string, filter?: TimeFilter) =>
    get<CatchphraseAnalysis>(`/sessions/${sessionId}/catchphrase-analysis`, filterQuery(filter)),

  getMentionAnalysis: (sessionId: string, filter?: TimeFilter) =>
    get<MentionAnalysis>(`/sessions/${sessionId}/mention-analysis`, filterQuery(filter)),

  getMentionGraph: (sessionId: string, filter?: TimeFilter) =>
    get<MentionGraphData>(`/sessions/${sessionId}/mention-graph`, filterQuery(filter)),

  getClusterGraph: (sessionId: string, filter?: TimeFilter, options?: ClusterGraphOptions) =>
    get<ClusterGraphData>(`/sessions/${sessionId}/cluster-graph`, {
      ...filterQuery(filter),
      ...(options ? { options: JSON.stringify(options) } : {}),
    }),

  getLaughAnalysis: (sessionId: string, filter?: TimeFilter, keywords?: string[]) =>
    get<LaughAnalysis>(`/sessions/${sessionId}/laugh-analysis`, {
      ...filterQuery(filter),
      ...(keywords ? { keywords: JSON.stringify(keywords) } : {}),
    }),

  // ── Members ──

  getMembers: (sessionId: string) =>
    get<MemberWithStats[]>(`/sessions/${sessionId}/members`),

  getMembersPaginated: (sessionId: string, params: PaginationParams) =>
    get<PaginatedMembers>(`/sessions/${sessionId}/members/paginated`, params as Record<string, unknown>),

  updateMemberAliases: (sessionId: string, memberId: number, aliases: string[]) =>
    patch<boolean>(`/sessions/${sessionId}/members/${memberId}/aliases`, { aliases }),

  deleteMember: (sessionId: string, memberId: number) =>
    del<boolean>(`/sessions/${sessionId}/members/${memberId}`),

  // ── Plugins ──

  pluginQuery: <T = Record<string, unknown>>(sessionId: string, sql: string, params: unknown[] = []) =>
    post<T[]>(`/sessions/${sessionId}/sql`, { sql, params }),

  pluginCompute: <T = unknown>(_fnString: string, _input: unknown): Promise<T> => {
    // pluginCompute ran functions in a worker in Electron.
    // In the web app this would need a server-side sandbox.
    // For now, throw to make callers aware it's unimplemented.
    return Promise.reject(new Error('pluginCompute is not supported in the web app'))
  },

  // ── SQL Lab ──

  executeSQL: (sessionId: string, sql: string) =>
    post<SQLResult>(`/sessions/${sessionId}/sql`, { sql }),

  getSchema: (sessionId: string) =>
    get<TableSchema[]>(`/sessions/${sessionId}/schema`),

  // ── Incremental import ──

  analyzeIncrementalImport: (sessionId: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return upload<{
      newMessageCount: number
      duplicateCount: number
      totalInFile: number
      error?: string
      diagnosis?: { suggestion?: string }
    }>(`/sessions/${sessionId}/analyze-incremental`, fd)
  },

  incrementalImport: (sessionId: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return upload<{
      success: boolean
      newMessageCount: number
      error?: string
    }>(`/sessions/${sessionId}/incremental-import`, fd)
  },

  exportSessionsToTempFiles: (sessionIds: string[]) =>
    post<{ success: boolean; tempFiles: string[]; error?: string }>('/merge/export-sessions', { sessionIds }),

  cleanupTempExportFiles: (filePaths: string[]) =>
    post<{ success: boolean; error?: string }>('/merge/cleanup-temp', { filePaths }),

  // ── Import progress (SSE-based) ──

  /**
   * In the web app, import progress events are received via SSE
   * from the import endpoint's response stream rather than via IPC.
   * This is a no-op placeholder that returns an unsubscribe function.
   */
  onImportProgress: (_callback: (progress: ImportProgress) => void): (() => void) => {
    // The web import endpoint should stream progress in its response.
    // Individual component implementations will handle this via fetch streaming.
    return () => {}
  },
}
