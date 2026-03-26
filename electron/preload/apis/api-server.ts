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

export const apiServerApi = {
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
}
