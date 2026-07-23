import {
  deleteAuthProfile,
  deriveAuthProfileName,
  loadAuthProfiles,
  resolveApiKey,
  writeAuthProfile,
  type AuthProfile,
  type AuthProfilesData,
} from '@openchatlab/config'
import { LLMConfigStore, type AIServiceConfig, type ConfigStorage, type LLMConfigStoreDeps } from './llm-config-store'

export interface AuthProfileLlmConfigStoreDeps extends Pick<LLMConfigStoreDeps, 't' | 'generateId' | 'onStoreLoaded'> {
  resolveApiKey: (provider: string, authProfile?: string) => string | undefined
  loadAuthProfiles: () => AuthProfilesData
  writeAuthProfile: (name: string, profile: AuthProfile) => void
  deleteAuthProfile: (name: string) => void
}

const defaultDeps: AuthProfileLlmConfigStoreDeps = {
  resolveApiKey: (provider, authProfile) => resolveApiKey(provider, authProfile) || undefined,
  loadAuthProfiles,
  writeAuthProfile,
  deleteAuthProfile,
}

function getAuthProfile(config: AIServiceConfig): string | undefined {
  return (config as unknown as Record<string, unknown>).authProfile as string | undefined
}

function getNamedAuthProfile(config: Pick<AIServiceConfig, 'name' | 'provider'>): string {
  return config.name?.toLowerCase().replace(/\s+/g, '-') || config.provider
}

function restoreLegacyAuthProfileReferences(configs: AIServiceConfig[], authProfiles: AuthProfilesData): void {
  const usedProfiles = new Set(configs.map(getAuthProfile).filter((name): name is string => Boolean(name)))

  for (const config of configs) {
    if (getAuthProfile(config)) continue

    const namedProfile = getNamedAuthProfile(config)
    const namedProfileValue = authProfiles.profiles[namedProfile]
    if (namedProfileValue?.provider === config.provider && !usedProfiles.has(namedProfile)) {
      ;(config as unknown as Record<string, unknown>).authProfile = namedProfile
      usedProfiles.add(namedProfile)
      continue
    }

    const baseName = deriveAuthProfileName(config.provider, config)
    for (let index = 1; index <= Object.keys(authProfiles.profiles).length; index++) {
      const candidate = index === 1 ? baseName : `${baseName}-${index}`
      const profile = authProfiles.profiles[candidate]
      if (!profile || profile.provider !== config.provider || usedProfiles.has(candidate)) continue
      ;(config as unknown as Record<string, unknown>).authProfile = candidate
      usedProfiles.add(candidate)
      break
    }
  }
}

export function createAuthProfileLlmConfigStore(
  storage: ConfigStorage,
  deps: Partial<AuthProfileLlmConfigStoreDeps> = {}
): LLMConfigStore {
  const resolvedDeps = { ...defaultDeps, ...deps }
  return new LLMConfigStore(storage, {
    t: deps.t,
    generateId: deps.generateId,
    onStoreLoaded: (configs) => {
      restoreLegacyAuthProfileReferences(configs, resolvedDeps.loadAuthProfiles())
      deps.onStoreLoaded?.(configs)
    },
    resolveApiKey: resolvedDeps.resolveApiKey,
    onApiKeyCreated: (config, apiKey) => {
      const profileName = getNamedAuthProfile(config)
      resolvedDeps.writeAuthProfile(profileName, { type: 'api_key', provider: config.provider, key: apiKey })
      return profileName
    },
    onApiKeyDeleted: (config) => {
      const profileName = getAuthProfile(config)
      if (profileName) resolvedDeps.deleteAuthProfile(profileName)
    },
  })
}
