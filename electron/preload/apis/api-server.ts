/**
 * ChatLab API 服务 Preload API (hierarchical data source model)
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

  addDataSource: (partial: { name?: string; baseUrl: string; token: string; intervalMinutes: number }): Promise<DataSource> => {
    return ipcRenderer.invoke('api:addDataSource', partial)
  },

  updateDataSource: (
    id: string,
    updates: Partial<Pick<DataSource, 'name' | 'baseUrl' | 'token' | 'intervalMinutes' | 'enabled'>>
  ): Promise<DataSource | null> => {
    return ipcRenderer.invoke('api:updateDataSource', id, updates)
  },

  deleteDataSource: (id: string): Promise<boolean> => {
    return ipcRenderer.invoke('api:deleteDataSource', id)
  },

  // ==================== 导入会话管理 ====================

  addImportSessions: (
    sourceId: string,
    sessions: Array<{ name: string; remoteSessionId: string }>
  ): Promise<ImportSession[]> => {
    return ipcRenderer.invoke('api:addImportSessions', sourceId, sessions)
  },

  removeImportSession: (sourceId: string, sessionId: string): Promise<boolean> => {
    return ipcRenderer.invoke('api:removeImportSession', sourceId, sessionId)
  },

  // ==================== 同步 ====================

  triggerPull: (sourceId: string, sessionId?: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('api:triggerPull', sourceId, sessionId)
  },

  triggerPullAll: (sourceId: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('api:triggerPullAll', sourceId)
  },

  fetchRemoteSessions: (baseUrl: string, token?: string): Promise<RemoteSession[]> => {
    return ipcRenderer.invoke('api:fetchRemoteSessions', baseUrl, token || '')
  },

  onPullResult: (
    callback: (data: { sourceId: string; sessionId?: string; status: string; detail: string }) => void
  ): (() => void) => {
    const handler = (
      _event: any,
      data: { sourceId: string; sessionId?: string; status: string; detail: string }
    ) => callback(data)
    ipcRenderer.on('api:pullResult', handler)
    return () => ipcRenderer.removeListener('api:pullResult', handler)
  },

  onImportCompleted: (callback: () => void): (() => void) => {
    const handler = () => callback()
    ipcRenderer.on('api:importCompleted', handler)
    return () => ipcRenderer.removeListener('api:importCompleted', handler)
  },
}
