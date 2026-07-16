import { deleteAuthProfile, resolveApiKey, writeAuthProfile, type AuthProfile } from '@openchatlab/config'
import { LLMConfigStore, type AIServiceConfig, type ConfigStorage } from './llm-config-store'

export interface AuthProfileLlmConfigStoreDeps {
  resolveApiKey: (provider: string, authProfile?: string) => string | undefined
  writeAuthProfile: (name: string, profile: AuthProfile) => void
  deleteAuthProfile: (name: string) => void
}

const defaultDeps: AuthProfileLlmConfigStoreDeps = {
  resolveApiKey: (provider, authProfile) => resolveApiKey(provider, authProfile) || undefined,
  writeAuthProfile,
  deleteAuthProfile,
}

function getAuthProfile(config: AIServiceConfig): string | undefined {
  return (config as unknown as Record<string, unknown>).authProfile as string | undefined
}

export function createAuthProfileLlmConfigStore(
  storage: ConfigStorage,
  deps: AuthProfileLlmConfigStoreDeps = defaultDeps
): LLMConfigStore {
  return new LLMConfigStore(storage, {
    resolveApiKey: deps.resolveApiKey,
    onApiKeyCreated: (config, apiKey) => {
      const profileName = config.name?.toLowerCase().replace(/\s+/g, '-') || config.provider
      deps.writeAuthProfile(profileName, { type: 'api_key', provider: config.provider, key: apiKey })
      return profileName
    },
    onApiKeyDeleted: (config) => {
      const profileName = getAuthProfile(config)
      if (profileName) deps.deleteAuthProfile(profileName)
    },
  })
}
