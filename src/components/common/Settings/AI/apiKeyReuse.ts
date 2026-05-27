export type ConnectionMode = 'preset' | 'local' | 'openai-compat'

export interface ApiKeyReuseInput {
  mode: 'add' | 'edit'
  existingApiKeySet?: boolean
  hasNewApiKey: boolean
  originalProvider?: string
  currentProvider: string
  originalConnectionMode?: ConnectionMode
  currentConnectionMode: ConnectionMode
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
  return (
    input.mode === 'edit' &&
    !!input.existingApiKeySet &&
    !input.hasNewApiKey &&
    input.originalProvider === input.currentProvider &&
    input.originalConnectionMode === input.currentConnectionMode
  )
}
