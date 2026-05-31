/**
 * Internal API Server endpoint — Preload API
 *
 * Exposes the Internal Server's baseUrl and ephemeral token to the Renderer.
 * Token is held in memory only (never persisted to localStorage/sessionStorage).
 */

import { ipcRenderer } from 'electron'

export interface InternalEndpoint {
  baseUrl: string
  token: string
}

export const internalApi = {
  getEndpoint: (): Promise<InternalEndpoint | null> => ipcRenderer.invoke('internal-api:getEndpoint'),
}
