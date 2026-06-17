/**
 * useSemanticIndexService — 语义索引前端服务
 *
 * 直连共享 Web 路由 /_web/ai/semantic-index/*（Electron Internal API 与 CLI Web 复用）。
 * 入参以 sessionId 暴露，不涉及 db_path_hash。
 */

import { get, post, put } from '../utils/http'
import type { SemanticIndexConfig, SemanticIndexSessionStatus } from './types'

const BASE = '/ai/semantic-index'

export interface SemanticIndexService {
  getConfig(): Promise<{ config: SemanticIndexConfig; apiKeySet: boolean }>
  setConfig(config: SemanticIndexConfig, apiKey?: string): Promise<{ config: SemanticIndexConfig; apiKeySet: boolean }>
  listEnabled(): Promise<SemanticIndexSessionStatus[]>
  status(sessionId: string): Promise<SemanticIndexSessionStatus | null>
  statusForSessions(sessionIds: string[]): Promise<SemanticIndexSessionStatus[]>
  enable(sessionId: string): Promise<SemanticIndexSessionStatus | null>
  disable(sessionId: string): Promise<SemanticIndexSessionStatus | null>
  build(sessionId: string): Promise<SemanticIndexSessionStatus | null>
  pause(sessionId: string): Promise<SemanticIndexSessionStatus | null>
  cancel(sessionId: string): Promise<SemanticIndexSessionStatus | null>
  rebuild(sessionId: string): Promise<SemanticIndexSessionStatus | null>
  buildPending(): Promise<SemanticIndexSessionStatus[]>
  cleanup(): Promise<{ cleaned: number }>
}

function sessionAction(action: string) {
  return async (sessionId: string): Promise<SemanticIndexSessionStatus | null> => {
    const res = await post<{ status: SemanticIndexSessionStatus | null }>(`${BASE}/${action}`, { sessionId })
    return res.status
  }
}

const instance: SemanticIndexService = {
  getConfig: () => get(`${BASE}/config`),
  setConfig: (config, apiKey) => put(`${BASE}/config`, { config, apiKey }),
  listEnabled: async () => (await get<{ sessions: SemanticIndexSessionStatus[] }>(`${BASE}/enabled`)).sessions,
  status: async (sessionId) =>
    (
      await get<{ status: SemanticIndexSessionStatus | null }>(
        `${BASE}/status?sessionId=${encodeURIComponent(sessionId)}`
      )
    ).status,
  statusForSessions: async (sessionIds) =>
    (await post<{ sessions: SemanticIndexSessionStatus[] }>(`${BASE}/status`, { sessionIds })).sessions,
  enable: sessionAction('enable'),
  disable: sessionAction('disable'),
  build: sessionAction('build'),
  pause: sessionAction('pause'),
  cancel: sessionAction('cancel'),
  rebuild: sessionAction('rebuild'),
  buildPending: async () => (await post<{ sessions: SemanticIndexSessionStatus[] }>(`${BASE}/build-pending`)).sessions,
  cleanup: () => post(`${BASE}/cleanup`),
}

export function useSemanticIndexService(): SemanticIndexService {
  return instance
}
