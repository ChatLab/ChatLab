/**
 * Network/proxy API client — replaces window.networkApi
 *
 * Maps preload IPC calls to HTTP endpoints under /api/network.
 */

import { get, put, post } from './client'

// ─────────────────────────── types ───────────────────────────

export type ProxyMode = 'off' | 'system' | 'manual'

export interface ProxyConfig {
  mode: ProxyMode
  url: string
}

// ─────────────────────────── networkApi ───────────────────────────

export const networkApi = {
  getProxyConfig: () => get<ProxyConfig>('/network/proxy'),

  saveProxyConfig: (config: ProxyConfig) =>
    put<{ success: boolean; error?: string }>('/network/proxy', config),

  testProxyConnection: (proxyUrl: string) =>
    post<{ success: boolean; error?: string }>('/network/proxy/test', { proxyUrl }),
}
