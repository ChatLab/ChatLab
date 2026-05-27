type LlmConfigRecord = Record<string, unknown>

type ResolveApiKey = (provider: string, authProfile?: string) => string | undefined
const NO_KEY_PLACEHOLDER = 'sk-no-key-required'

function hasRealApiKey(apiKey: string): boolean {
  return !!apiKey && apiKey !== NO_KEY_PLACEHOLDER
}

export function toLlmConfigDisplay(config: LlmConfigRecord, resolveApiKey: ResolveApiKey): LlmConfigRecord {
  const { apiKey: _rawApiKey, ...rest } = config
  const provider = typeof config.provider === 'string' ? config.provider : ''
  const authProfile = typeof config.authProfile === 'string' ? config.authProfile : undefined
  const resolvedApiKey = provider ? resolveApiKey(provider, authProfile) : ''

  return {
    ...rest,
    apiKey: '',
    apiKeySet: hasRealApiKey(resolvedApiKey || ''),
  }
}
