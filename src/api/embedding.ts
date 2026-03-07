/**
 * Embedding configuration API client — replaces window.embeddingApi
 *
 * Maps preload IPC calls to HTTP endpoints under /api/embedding.
 */

import { get, post, put, del } from './client'

// ─────────────────────────── types ───────────────────────────

export interface EmbeddingServiceConfig {
  id: string
  name: string
  apiSource: 'reuse_llm' | 'custom'
  model: string
  baseUrl?: string
  apiKey?: string
  createdAt: number
  updatedAt: number
}

export interface EmbeddingServiceConfigDisplay {
  id: string
  name: string
  apiSource: 'reuse_llm' | 'custom'
  model: string
  baseUrl?: string
  apiKeySet: boolean
  createdAt: number
  updatedAt: number
}

// ─────────────────────────── embeddingApi ───────────────────────────

export const embeddingApi = {
  getAllConfigs: () =>
    get<EmbeddingServiceConfigDisplay[] | { configs: EmbeddingServiceConfigDisplay[] }>('/embedding/configs').then(
      (r) => (Array.isArray(r) ? r : r.configs),
    ),

  getConfig: (id: string) =>
    get<EmbeddingServiceConfig | null>(`/embedding/configs/${id}`),

  getActiveConfigId: () =>
    get<{ configs: EmbeddingServiceConfigDisplay[]; activeConfigId: string | null }>('/embedding/configs').then(
      // The embedding configs endpoint may return { configs, activeConfigId } similar to LLM,
      // or may just return configs array. We try the object shape first, fallback to null.
      (r) => {
        if (r && typeof r === 'object' && 'activeConfigId' in r) {
          return (r as { activeConfigId: string | null }).activeConfigId
        }
        return null
      },
    ) as Promise<string | null>,

  isEnabled: () =>
    get<{ enabled: boolean }>('/embedding/configs')
      .then((r) => {
        if (r && typeof r === 'object' && 'enabled' in r) return (r as { enabled: boolean }).enabled
        // If we got configs back, enabled means at least one exists
        return Array.isArray(r) && r.length > 0
      }) as Promise<boolean>,

  addConfig: (config: Omit<EmbeddingServiceConfig, 'id' | 'createdAt' | 'updatedAt'>) =>
    post<EmbeddingServiceConfig>('/embedding/configs', config)
      .then((c) => ({ success: true, config: c }))
      .catch((e) => ({ success: false, error: String(e) })) as Promise<{
      success: boolean
      config?: EmbeddingServiceConfig
      error?: string
    }>,

  updateConfig: (id: string, updates: Partial<Omit<EmbeddingServiceConfig, 'id' | 'createdAt' | 'updatedAt'>>) =>
    put<{ success: boolean; error?: string }>(`/embedding/configs/${id}`, updates),

  deleteConfig: (id: string) =>
    del<{ success: boolean; error?: string }>(`/embedding/configs/${id}`),

  setActiveConfig: (id: string) =>
    put<{ success: boolean; error?: string }>(`/embedding/configs/${id}/activate`),

  validateConfig: (config: EmbeddingServiceConfig) =>
    post<{ success: boolean; error?: string }>('/embedding/validate', config),

  getVectorStoreStats: () =>
    get<{ enabled: boolean; count?: number; sizeBytes?: number }>('/embedding/vector-store/stats'),

  clearVectorStore: () =>
    post<{ success: boolean; error?: string }>('/embedding/vector-store/clear'),
}
