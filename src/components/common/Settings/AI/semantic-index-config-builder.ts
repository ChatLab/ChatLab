import type { SemanticIndexConfig } from '@/services'
import type { ModelConfigDraft } from './semantic-index-models'

function normalizeBaseUrl(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '')
}

/** Local Ollama's OpenAI-compatible endpoint does not require authentication. */
export function isSemanticIndexApiKeyRequired(apiBaseUrl: string | undefined): boolean {
  if (!apiBaseUrl) return true
  try {
    const url = new URL(apiBaseUrl)
    const host = url.hostname.toLowerCase()
    const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1'
    const port = url.port || (url.protocol === 'https:' ? '443' : '80')
    return !(isLoopback && port === '11434')
  } catch {
    return true
  }
}

export function canReuseSemanticIndexApiAuthProfile(
  savedConfig: SemanticIndexConfig | null,
  apiBaseUrl: string,
  apiKeySet = true
): boolean {
  if (!apiKeySet) return false
  if (savedConfig?.mode !== 'api' || !savedConfig.api?.authProfile) return false
  return normalizeBaseUrl(savedConfig.api.baseUrl) === normalizeBaseUrl(apiBaseUrl)
}

export function buildSemanticIndexModelConfig(
  savedConfig: SemanticIndexConfig | null,
  payload: ModelConfigDraft
): SemanticIndexConfig {
  const apiBaseUrl = payload.apiBaseUrl.trim()
  const apiModel = payload.apiModel.trim()
  const reusableAuthProfile = canReuseSemanticIndexApiAuthProfile(savedConfig, apiBaseUrl)
    ? savedConfig?.api?.authProfile
    : undefined

  return {
    version: savedConfig?.version ?? 1,
    enabled: savedConfig?.enabled ?? true,
    mode: payload.mode,
    local: { modelId: payload.localModelId },
    api:
      payload.mode === 'api'
        ? {
            baseUrl: apiBaseUrl,
            model: apiModel,
            ...(reusableAuthProfile ? { authProfile: reusableAuthProfile } : {}),
          }
        : null,
    searchMaxResults: 10,
  }
}
