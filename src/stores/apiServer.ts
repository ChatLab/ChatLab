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
    await Promise.all([fetchConfig(), fetchStatus()])
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

  return {
    config,
    status,
    loading,
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
  }
})
