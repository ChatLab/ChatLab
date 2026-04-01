/**
 * ChatLab API 服务状态 Store
 */

import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

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

export interface DataSource {
  id: string
  name: string
  url: string
  token: string
  intervalMinutes: number
  enabled: boolean
  targetSessionId: string
  lastPullAt: number
  lastStatus: 'idle' | 'success' | 'error'
  lastError: string
  lastNewMessages: number
  createdAt: number
}

export const useApiServerStore = defineStore('apiServer', () => {
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
  const pullingId = ref<string | null>(null)

  const isRunning = computed(() => status.value.running)
  const hasError = computed(() => !!status.value.error)
  const isPortInUse = computed(() => status.value.error?.startsWith('PORT_IN_USE') ?? false)

  async function fetchConfig() {
    try {
      config.value = await window.apiServerApi.getConfig()
    } catch (err) {
      console.error('[ApiServerStore] Failed to fetch config:', err)
    }
  }

  async function fetchStatus() {
    try {
      status.value = await window.apiServerApi.getStatus()
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
      status.value = await window.apiServerApi.setEnabled(enabled)
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
      status.value = await window.apiServerApi.setPort(port)
      await fetchConfig()
    } catch (err) {
      console.error('[ApiServerStore] Failed to set port:', err)
    } finally {
      loading.value = false
    }
  }

  async function regenerateToken() {
    try {
      config.value = await window.apiServerApi.regenerateToken()
    } catch (err) {
      console.error('[ApiServerStore] Failed to regenerate token:', err)
    }
  }

  function listenStartupError() {
    return window.apiServerApi.onStartupError((data) => {
      status.value.error = data.error
      status.value.running = false
    })
  }

  // ==================== 数据源管理 ====================

  async function fetchDataSources() {
    try {
      dataSources.value = await window.apiServerApi.getDataSources()
    } catch (err) {
      console.error('[ApiServerStore] Failed to fetch data sources:', err)
    }
  }

  async function addDataSource(partial: Omit<DataSource, 'id' | 'createdAt' | 'lastPullAt' | 'lastStatus' | 'lastError' | 'lastNewMessages'>) {
    try {
      const ds = await window.apiServerApi.addDataSource(partial)
      dataSources.value.push(ds)
      return ds
    } catch (err) {
      console.error('[ApiServerStore] Failed to add data source:', err)
      return null
    }
  }

  async function updateDataSource(id: string, updates: Partial<DataSource>) {
    try {
      const ds = await window.apiServerApi.updateDataSource(id, updates)
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
      const ok = await window.apiServerApi.deleteDataSource(id)
      if (ok) {
        dataSources.value = dataSources.value.filter((s) => s.id !== id)
      }
      return ok
    } catch (err) {
      console.error('[ApiServerStore] Failed to delete data source:', err)
      return false
    }
  }

  async function triggerPull(id: string) {
    pullingId.value = id
    try {
      const result = await window.apiServerApi.triggerPull(id)
      await fetchDataSources()
      return result
    } catch (err) {
      console.error('[ApiServerStore] Failed to trigger pull:', err)
      return { success: false, error: String(err) }
    } finally {
      pullingId.value = null
    }
  }

  function listenPullResult() {
    return window.apiServerApi.onPullResult(() => {
      fetchDataSources()
    })
  }

  return {
    config,
    status,
    loading,
    dataSources,
    pullingId,
    isRunning,
    hasError,
    isPortInUse,
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
    triggerPull,
    listenPullResult,
  }
})
