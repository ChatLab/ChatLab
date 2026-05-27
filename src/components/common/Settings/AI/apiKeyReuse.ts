export type ConnectionMode = 'preset' | 'local' | 'openai-compat'

export interface ApiKeyReuseInput {
  mode: 'add' | 'edit'
  existingApiKeySet?: boolean
  hasNewApiKey: boolean
  originalProvider?: string
  currentProvider: string
  originalConnectionMode?: ConnectionMode
  currentConnectionMode: ConnectionMode
  /** Original base URL (for openai-compat mode endpoint change detection) */
  originalBaseUrl?: string
  /** Current base URL entered by the user */
  currentBaseUrl?: string
}

export function getConnectionModeForConfig(config: {
  provider: string
  apiKeySet: boolean
  baseUrl?: string
}): ConnectionMode {
  const isCompat = config.provider === 'openai-compatible' || config.provider.startsWith('custom:')
  if (!isCompat) return 'preset'

  const looksLocal = !config.apiKeySet || (config.baseUrl?.includes('localhost') ?? false)
  return looksLocal ? 'local' : 'openai-compat'
}

export function canReuseExistingApiKey(input: ApiKeyReuseInput): boolean {
  const baseConditions =
    input.mode === 'edit' &&
    !!input.existingApiKeySet &&
    !input.hasNewApiKey &&
    input.originalProvider === input.currentProvider &&
    input.originalConnectionMode === input.currentConnectionMode

  if (!baseConditions) return false

  // For openai-compat mode, a base URL change means a different endpoint/service,
  // so the existing credential must not be silently reused without re-validation.
  if (input.currentConnectionMode === 'openai-compat') {
    const normalizeUrl = (url?: string) => url?.trim().replace(/\/+$/, '') || ''
    return normalizeUrl(input.originalBaseUrl) === normalizeUrl(input.currentBaseUrl)
  }

  return true
}
