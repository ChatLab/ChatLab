import { getBuiltinModelById, getBuiltinProviderById } from '@openchatlab/core'
import { createAuthProfileLlmConfigStore, type AuthProfileLlmConfigStoreDeps } from './auth-profile-llm-config-store'
import { CustomModelStore, CustomProviderStore } from './custom-store'
import { createFileConfigStorage } from './file-config-storage'
import type { AIServiceConfig, LLMConfigStore, LLMConfigStoreDeps } from './llm-config-store'

export interface LlmRuntimeStores {
  llmConfigStore: LLMConfigStore
  customProviderStore: CustomProviderStore
  customModelStore: CustomModelStore
}

export interface CreateLlmRuntimeStoresOptions extends Pick<LLMConfigStoreDeps, 't' | 'generateId' | 'onStoreLoaded'> {
  authProfileDeps?: Partial<
    Pick<AuthProfileLlmConfigStoreDeps, 'resolveApiKey' | 'loadAuthProfiles' | 'writeAuthProfile' | 'deleteAuthProfile'>
  >
}

function ensureLegacyCustomModels(configs: AIServiceConfig[], customModelStore: CustomModelStore): void {
  for (const config of configs) {
    const providerId = config.provider

    if (config.model && getBuiltinProviderById(providerId) && !getBuiltinModelById(providerId, config.model)) {
      customModelStore.add({
        id: config.model,
        providerId,
        name: config.model,
        capabilities: ['chat'],
        recommendedFor: ['chat'],
        status: 'stable',
      })
    }
  }
}

export function createLlmRuntimeStores(
  aiDataDir: string,
  options: CreateLlmRuntimeStoresOptions = {}
): LlmRuntimeStores {
  const storage = createFileConfigStorage(aiDataDir)
  const customProviderStore = new CustomProviderStore(storage)
  const customModelStore = new CustomModelStore(storage)
  const llmConfigStore = createAuthProfileLlmConfigStore(storage, {
    ...options.authProfileDeps,
    t: options.t,
    generateId: options.generateId,
    onStoreLoaded: (configs) => {
      ensureLegacyCustomModels(configs, customModelStore)
      options.onStoreLoaded?.(configs)
    },
  })

  return {
    llmConfigStore,
    customProviderStore,
    customModelStore,
  }
}
