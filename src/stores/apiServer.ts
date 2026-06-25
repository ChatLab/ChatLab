/**
 * ChatLab API 服务状态 Store (hierarchical data source model)
 *
 * Supports dual transport:
 * - Electron: window.apiServerApi (IPC)
 * - CLI Web: HTTP fetch to /_web/automation/* endpoints
 */

import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { IS_ELECTRON } from '@/utils/platform'
import { useSessionStore } from './session'
import { useSessionIndexService } from '@/services/session-index/service'
import { getSessionGapThreshold } from '@/composables/useUiConfig'
import { fetchWithAuth } from '@/services/utils/http'
import { createSyncResultPoller } from './syncResultPolling'

export interface ApiServerConfig {
  enabled: boolean
  port: number
  token: string
  createdAt: number
}

export interface ApiServerStatus {
  running: boolean
  port: number | null
  startedAt: number | null
  error: string | null
}

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

// ==================== Transport abstraction ====================

interface ApiTransport {
  getConfig(): Promise<ApiServerConfig>
  getStatus(): Promise<ApiServerStatus>
  setEnabled(enabled: boolean): Promise<ApiServerStatus>
  setPort(port: number): Promise<ApiServerStatus>
  regenerateToken(): Promise<ApiServerConfig>
  onStartupError(cb: (data: { error: string }) => void): () => void
  getDataSources(): Promise<DataSource[]>
  addDataSource(partial: {
    name?: string
    baseUrl: string
    token: string
    intervalMinutes: number
    pullLimit?: number
  }): Promise<DataSource>
  updateDataSource(
    id: string,
    updates: Partial<Pick<DataSource, 'name' | 'baseUrl' | 'token' | 'intervalMinutes' | 'pullLimit' | 'enabled'>>
  ): Promise<DataSource | null>
  deleteDataSource(id: string): Promise<boolean>
  addImportSessions(
    sourceId: string,
    sessions: Array<{ name: string; remoteSessionId: string }>
  ): Promise<ImportSession[]>
  removeImportSession(sourceId: string, sessionId: string, deleteData?: boolean): Promise<boolean>
  triggerPull(sourceId: string, sessionId?: string): Promise<{ success: boolean; error?: string }>
  triggerPullAll(sourceId: string): Promise<{ success: boolean; error?: string }>
  onPullResult(cb: () => void): () => void
  fetchRemoteSessions(
    baseUrl: string,
    token?: string,
    query?: { keyword?: string; limit?: number; cursor?: string }
  ): Promise<RemoteSessionDiscoveryResult>
}

function createElectronTransport(): ApiTransport {
  const api = window.apiServerApi
  return {
    getConfig: () => api.getConfig(),
    getStatus: () => api.getStatus(),
    setEnabled: (enabled) => api.setEnabled(enabled),
    setPort: (port) => api.setPort(port),
    regenerateToken: () => api.regenerateToken(),
    onStartupError: (cb) => api.onStartupError(cb),
    getDataSources: () => api.getDataSources(),
    addDataSource: (partial) => api.addDataSource(partial),
    updateDataSource: (id, updates) => api.updateDataSource(id, updates),
    deleteDataSource: (id) => api.deleteDataSource(id),
    addImportSessions: (sourceId, sessions) => api.addImportSessions(sourceId, sessions),
    removeImportSession: (sourceId, sessionId, deleteData?) => api.removeImportSession(sourceId, sessionId, deleteData),
    triggerPull: (sourceId, sessionId?) => api.triggerPull(sourceId, sessionId),
    triggerPullAll: (sourceId) => api.triggerPullAll(sourceId),
    onPullResult: (cb) => api.onPullResult(cb),
    fetchRemoteSessions: (baseUrl, token?, query?) => api.fetchRemoteSessions(baseUrl, token, query),
  }
}

function createWebTransport(): ApiTransport {
  const noop = () => () => {}

  async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
    const resp = await fetchWithAuth(url, options)
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}))
      throw new Error((body as any)?.error || `HTTP ${resp.status}`)
    }
    return resp.json()
  }

  return {
    getConfig: () => fetchJson('/_web/automation/config'),

    getStatus: async () => ({
      running: true,
      port: null,
      startedAt: null,
      error: null,
    }),

    setEnabled: async () => ({
      running: true,
      port: null,
      startedAt: null,
      error: null,
    }),

    setPort: async () => ({
      running: true,
      port: null,
      startedAt: null,
      error: null,
    }),

    regenerateToken: async () => fetchJson('/_web/automation/config'),

    onStartupError: noop,

    getDataSources: () => fetchJson('/_web/automation/data-sources'),

    addDataSource: (partial) =>
      fetchJson('/_web/automation/data-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      }),

    updateDataSource: (id, updates) =>
      fetchJson(`/_web/automation/data-sources/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      }),

    deleteDataSource: async (id) => {
      const result = await fetchJson<{ success: boolean }>(`/_web/automation/data-sources/${id}`, {
        method: 'DELETE',
      })
      return result.success
    },

    addImportSessions: (sourceId, sessions) =>
      fetchJson(`/_web/automation/data-sources/${sourceId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessions }),
      }),

    removeImportSession: async (sourceId, sessionId, deleteData?) => {
      const qs = deleteData ? '?deleteData=true' : ''
      const result = await fetchJson<{ success: boolean }>(
        `/_web/automation/data-sources/${sourceId}/sessions/${sessionId}${qs}`,
        { method: 'DELETE' }
      )
      return result.success
    },

    triggerPull: (sourceId, sessionId?) =>
      fetchJson(`/_web/automation/data-sources/${sourceId}/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }),

    triggerPullAll: (sourceId) => fetchJson(`/_web/automation/data-sources/${sourceId}/pull-all`, { method: 'POST' }),

    onPullResult: (cb) =>
      createSyncResultPoller({
        loadDataSources: () => fetchJson('/_web/automation/data-sources'),
        onResult: cb,
      }),

    fetchRemoteSessions: async (baseUrl, token?, query?) => {
      const params = new URLSearchParams({ baseUrl })
      if (token) params.set('token', token)
      if (query?.keyword) params.set('keyword', query.keyword)
      if (query?.limit) params.set('limit', String(query.limit))
      if (query?.cursor) params.set('cursor', query.cursor)
      return fetchJson(`/_web/automation/remote-sessions?${params}`)
    },
  }
}

function getTransport(): ApiTransport {
  if (IS_ELECTRON && typeof window !== 'undefined' && window.apiServerApi) {
    return createElectronTransport()
  }
  return createWebTransport()
}

// ==================== Store ====================

export const useApiServerStore = defineStore('apiServer', () => {
  const transport = getTransport()

  const config = ref<ApiServerConfig>({
    enabled: false,
    port: 5200,
    token: '',
    createdAt: 0,
  })

  const status = ref<ApiServerStatus>({
    running: false,
    port: null,
    startedAt: null,
    error: null,
  })

  const loading = ref(false)
  const dataSources = ref<DataSource[]>([])
  const pullingIds = ref(new Set<string>())
  const syncProgress = ref<Map<string, { current: number; pages: number }>>(new Map())
  const available = computed(() => true)

  const isRunning = computed(() => status.value.running)
  const hasError = computed(() => !!status.value.error)
  const isPortInUse = computed(() => status.value.error?.startsWith('PORT_IN_USE') ?? false)
  const isWebMode = computed(() => !IS_ELECTRON)

  async function fetchConfig() {
    try {
      config.value = await transport.getConfig()
    } catch (err) {
      console.error('[ApiServerStore] Failed to fetch config:', err)
    }
  }

  async function fetchStatus() {
    try {
      status.value = await transport.getStatus()
    } catch (err) {
      console.error('[ApiServerStore] Failed to fetch status:', err)
    }
  }

  async function refresh() {
    await Promise.all([fetchConfig(), fetchStatus(), fetchDataSources()])
  }

  async function setEnabled(enabled: boolean) {
    loading.value = true
    try {
      status.value = await transport.setEnabled(enabled)
      await fetchConfig()
    } catch (err) {
      console.error('[ApiServerStore] Failed to set enabled:', err)
    } finally {
      loading.value = false
    }
  }

  async function setPort(port: number) {
    loading.value = true
    try {
      status.value = await transport.setPort(port)
      await fetchConfig()
    } catch (err) {
      console.error('[ApiServerStore] Failed to set port:', err)
    } finally {
      loading.value = false
    }
  }

  async function regenerateToken() {
    try {
      config.value = await transport.regenerateToken()
    } catch (err) {
      console.error('[ApiServerStore] Failed to regenerate token:', err)
    }
  }

  function listenStartupError() {
    return transport.onStartupError((data) => {
      status.value.error = data.error
      status.value.running = false
    })
  }

  // ==================== 数据源管理 ====================

  async function fetchDataSources() {
    try {
      dataSources.value = await transport.getDataSources()
    } catch (err) {
      console.error('[ApiServerStore] Failed to fetch data sources:', err)
    }
  }

  async function addDataSource(partial: {
    name?: string
    baseUrl: string
    token: string
    intervalMinutes: number
    pullLimit?: number
  }) {
    try {
      const ds = await transport.addDataSource(partial)
      dataSources.value.push(ds)
      return ds
    } catch (err) {
      console.error('[ApiServerStore] Failed to add data source:', err)
      return null
    }
  }

  async function updateDataSource(
    id: string,
    updates: Partial<Pick<DataSource, 'name' | 'baseUrl' | 'token' | 'intervalMinutes' | 'pullLimit' | 'enabled'>>
  ) {
    try {
      const ds = await transport.updateDataSource(id, updates)
      if (ds) {
        const idx = dataSources.value.findIndex((s) => s.id === id)
        if (idx !== -1) dataSources.value[idx] = ds
      }
      return ds
    } catch (err) {
      console.error('[ApiServerStore] Failed to update data source:', err)
      return null
    }
  }

  async function deleteDataSource(id: string) {
    try {
      const ok = await transport.deleteDataSource(id)
      if (ok) {
        dataSources.value = dataSources.value.filter((s) => s.id !== id)
      }
      return ok
    } catch (err) {
      console.error('[ApiServerStore] Failed to delete data source:', err)
      return false
    }
  }

  // ==================== 导入会话管理 ====================

  async function addImportSessions(sourceId: string, sessions: Array<{ name: string; remoteSessionId: string }>) {
    try {
      const added = await transport.addImportSessions(sourceId, sessions)
      await fetchDataSources()
      if (added.length > 0) {
        for (const s of added) pullingIds.value.add(s.id)
        pullingIds.value = new Set(pullingIds.value)
        pollDataSourceUpdates(
          sourceId,
          added.map((s) => s.id)
        )
      }
      return added
    } catch (err) {
      console.error('[ApiServerStore] Failed to add import sessions:', err)
      return []
    }
  }

  function pollDataSourceUpdates(sourceId: string, sessionIds: string[], maxAttempts = 24, intervalMs = 5000) {
    let attempt = 0
    const timer = setInterval(async () => {
      attempt++
      await Promise.all([fetchDataSources(), fetchSyncProgress()])
      const ds = dataSources.value.find((s) => s.id === sourceId)
      const pending = sessionIds.filter((id) => {
        const sess = ds?.sessions.find((s) => s.id === id)
        return sess && sess.lastStatus === 'idle'
      })
      if (pending.length === 0 || attempt >= maxAttempts) {
        for (const id of sessionIds) {
          pullingIds.value.delete(id)
          syncProgress.value.delete(id)
        }
        pullingIds.value = new Set(pullingIds.value)
        syncProgress.value = new Map(syncProgress.value)
        clearInterval(timer)
      }
    }, intervalMs)
  }

  async function fetchSyncProgress() {
    if (!isWebMode.value) return
    try {
      const list = await fetchWithAuth('/_web/automation/sync-progress').then((r) => r.json())
      const map = new Map<string, { current: number; pages: number }>()
      for (const item of list as Array<{ sessionId: string; current: number; pages: number; done: boolean }>) {
        if (!item.done) map.set(item.sessionId, { current: item.current, pages: item.pages })
      }
      syncProgress.value = map
    } catch {
      /* ignore */
    }
  }

  async function removeImportSession(sourceId: string, sessionId: string, deleteData?: boolean) {
    try {
      const ok = await transport.removeImportSession(sourceId, sessionId, deleteData)
      if (ok) {
        await fetchDataSources()
        if (deleteData) useSessionStore().loadSessions()
      }
      return ok
    } catch (err) {
      console.error('[ApiServerStore] Failed to remove import session:', err)
      return false
    }
  }

  // ==================== 同步 ====================

  async function triggerPull(sourceId: string, sessionId?: string) {
    const trackId = sessionId || sourceId
    pullingIds.value.add(trackId)
    pullingIds.value = new Set(pullingIds.value)
    const progressTimer = startProgressPolling()
    try {
      const result = await transport.triggerPull(sourceId, sessionId)
      await fetchDataSources()
      await useSessionStore().loadSessions()
      generateIndexForSource(sourceId, sessionId)
      return result
    } catch (err) {
      console.error('[ApiServerStore] Failed to trigger pull:', err)
      return { success: false, error: String(err) }
    } finally {
      clearInterval(progressTimer)
      pullingIds.value.delete(trackId)
      pullingIds.value = new Set(pullingIds.value)
      syncProgress.value.delete(trackId)
      syncProgress.value = new Map(syncProgress.value)
    }
  }

  async function triggerPullAll(sourceId: string) {
    const ds = dataSources.value.find((s) => s.id === sourceId)
    const ids = [sourceId, ...(ds?.sessions.map((s) => s.id) ?? [])]
    for (const id of ids) pullingIds.value.add(id)
    pullingIds.value = new Set(pullingIds.value)
    const progressTimer = startProgressPolling()
    try {
      const result = await transport.triggerPullAll(sourceId)
      await fetchDataSources()
      await useSessionStore().loadSessions()
      generateIndexForSource(sourceId)
      return result
    } catch (err) {
      console.error('[ApiServerStore] Failed to trigger pull all:', err)
      return { success: false, error: String(err) }
    } finally {
      clearInterval(progressTimer)
      for (const id of ids) {
        pullingIds.value.delete(id)
        syncProgress.value.delete(id)
      }
      pullingIds.value = new Set(pullingIds.value)
      syncProgress.value = new Map(syncProgress.value)
    }
  }

  function startProgressPolling(): ReturnType<typeof setInterval> {
    return setInterval(fetchSyncProgress, 3000)
  }

  function listenPullResult() {
    return transport.onPullResult(async () => {
      await fetchDataSources()
      await useSessionStore().loadSessions()
      generateIndexForAllSources()
    })
  }

  function generateIndexForSource(sourceId: string, sessionId?: string) {
    const ds = dataSources.value.find((s) => s.id === sourceId)
    if (!ds) return
    const targets = sessionId
      ? ds.sessions.filter((s) => s.id === sessionId && s.targetSessionId)
      : ds.sessions.filter((s) => s.targetSessionId)
    const indexService = useSessionIndexService()
    const threshold = getSessionGapThreshold()
    for (const sess of targets) {
      indexService.generateIncremental(sess.targetSessionId, threshold).catch(() => {})
    }
  }

  function generateIndexForAllSources() {
    const indexService = useSessionIndexService()
    const threshold = getSessionGapThreshold()
    for (const ds of dataSources.value) {
      for (const sess of ds.sessions) {
        if (sess.targetSessionId) {
          indexService.generateIncremental(sess.targetSessionId, threshold).catch(() => {})
        }
      }
    }
  }

  async function fetchRemoteSessions(
    baseUrl: string,
    token?: string,
    query?: { keyword?: string; limit?: number; cursor?: string }
  ): Promise<RemoteSessionDiscoveryResult> {
    return transport.fetchRemoteSessions(baseUrl, token, query)
  }

  return {
    config,
    status,
    loading,
    dataSources,
    pullingIds,
    syncProgress,
    available,
    isRunning,
    hasError,
    isPortInUse,
    isWebMode,
    fetchConfig,
    fetchStatus,
    refresh,
    setEnabled,
    setPort,
    regenerateToken,
    listenStartupError,
    fetchDataSources,
    addDataSource,
    updateDataSource,
    deleteDataSource,
    addImportSessions,
    removeImportSession,
    triggerPull,
    triggerPullAll,
    listenPullResult,
    fetchRemoteSessions,
  }
})
