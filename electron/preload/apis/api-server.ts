/**
 * ChatLab API 服务 Preload API
 */

import { ipcRenderer } from 'electron'

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

export const apiServerApi = {
  // ==================== API 服务管理 ====================

  getConfig: (): Promise<ApiServerConfig> => {
    return ipcRenderer.invoke('api:getConfig')
  },

  getStatus: (): Promise<ApiServerStatus> => {
    return ipcRenderer.invoke('api:getStatus')
  },

  setEnabled: (enabled: boolean): Promise<ApiServerStatus> => {
    return ipcRenderer.invoke('api:setEnabled', enabled)
  },

  setPort: (port: number): Promise<ApiServerStatus> => {
    return ipcRenderer.invoke('api:setPort', port)
  },

  regenerateToken: (): Promise<ApiServerConfig> => {
    return ipcRenderer.invoke('api:regenerateToken')
  },

  onStartupError: (callback: (data: { error: string }) => void): (() => void) => {
    const handler = (_event: any, data: { error: string }) => callback(data)
    ipcRenderer.on('api:startupError', handler)
    return () => ipcRenderer.removeListener('api:startupError', handler)
  },

  // ==================== 数据源管理 ====================

  getDataSources: (): Promise<DataSource[]> => {
    return ipcRenderer.invoke('api:getDataSources')
  },

  addDataSource: (partial: Omit<DataSource, 'id' | 'createdAt' | 'lastPullAt' | 'lastStatus' | 'lastError' | 'lastNewMessages'>): Promise<DataSource> => {
    return ipcRenderer.invoke('api:addDataSource', partial)
  },

  updateDataSource: (id: string, updates: Partial<DataSource>): Promise<DataSource | null> => {
    return ipcRenderer.invoke('api:updateDataSource', id, updates)
  },

  deleteDataSource: (id: string): Promise<boolean> => {
    return ipcRenderer.invoke('api:deleteDataSource', id)
  },

  triggerPull: (id: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('api:triggerPull', id)
  },

  onPullResult: (callback: (data: { dsId: string; status: string; detail: string }) => void): (() => void) => {
    const handler = (_event: any, data: { dsId: string; status: string; detail: string }) => callback(data)
    ipcRenderer.on('api:pullResult', handler)
    return () => ipcRenderer.removeListener('api:pullResult', handler)
  },

  onImportCompleted: (callback: () => void): (() => void) => {
    const handler = () => callback()
    ipcRenderer.on('api:importCompleted', handler)
    return () => ipcRenderer.removeListener('api:importCompleted', handler)
  },
}
