import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { LLMConfigStore, type ConfigStorage, type AIConfigStore, type AIServiceConfig } from '../llm-config-store'

function createMemoryStorage(): ConfigStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  return {
    data,
    readJson<T>(key: string): T | null {
      return (data.get(key) as T) ?? null
    },
    writeJson<T>(key: string, value: T): void {
      data.set(key, JSON.parse(JSON.stringify(value)))
    },
  }
}

describe('LLMConfigStore', () => {
  let storage: ReturnType<typeof createMemoryStorage>
  let store: LLMConfigStore
  let idCounter: number

  beforeEach(() => {
    storage = createMemoryStorage()
    idCounter = 0
    store = new LLMConfigStore(storage, {
      generateId: () => `id-${++idCounter}`,
    })
  })

  it('returns empty store when no data', () => {
    const all = store.getAllConfigs()
    assert.equal(all.length, 0)
    assert.equal(store.hasActiveConfig(), false)
  })

  it('does not expose an unmigrated encrypted API key as a usable key', () => {
    storage.data.set('llm-config', {
      configs: [
        {
          id: 'legacy',
          name: 'Legacy',
          provider: 'openai',
          apiKey: 'enc:iv:tag:ciphertext',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      defaultAssistant: { configId: 'legacy', modelId: '' },
      fastModel: null,
    } satisfies AIConfigStore)
    const storeWithAuthResolution = new LLMConfigStore(storage, {
      resolveApiKey: () => undefined,
    })

    assert.equal(storeWithAuthResolution.getDefaultAssistantConfig()?.apiKey, '')
  })

  it('adds a config', () => {
    const result = store.addConfig({
      name: 'Test',
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4',
    })
    assert.ok(result.success)
    assert.equal(result.config!.id, 'id-1')
    assert.equal(result.config!.name, 'Test')
    assert.equal(store.getAllConfigs().length, 1)
  })

  it('sets first config as default assistant', () => {
    store.addConfig({ name: 'A', provider: 'openai', apiKey: 'k', model: 'gpt-4' })
    const slot = store.getDefaultAssistantSlot()
    assert.ok(slot)
    assert.equal(slot!.configId, 'id-1')
    assert.equal(slot!.modelId, 'gpt-4')
  })

  it('updates a config', () => {
    store.addConfig({ name: 'Old', provider: 'openai', apiKey: 'k' })
    const result = store.updateConfig('id-1', { name: 'New' })
    assert.ok(result.success)
    const config = store.getConfigById('id-1')
    assert.equal(config!.name, 'New')
  })

  it('returns error when updating non-existent config', () => {
    const result = store.updateConfig('nope', { name: 'X' })
    assert.equal(result.success, false)
    assert.ok(result.error)
  })

  it('deletes a config', () => {
    store.addConfig({ name: 'A', provider: 'openai', apiKey: 'k' })
    store.addConfig({ name: 'B', provider: 'openai', apiKey: 'k' })
    const result = store.deleteConfig('id-1')
    assert.ok(result.success)
    assert.equal(store.getAllConfigs().length, 1)
  })

  it('reassigns default assistant after deleting current default', () => {
    store.addConfig({ name: 'A', provider: 'openai', apiKey: 'k', model: 'gpt-4' })
    store.addConfig({ name: 'B', provider: 'openai', apiKey: 'k', model: 'gpt-3' })
    store.deleteConfig('id-1')
    const slot = store.getDefaultAssistantSlot()
    assert.equal(slot!.configId, 'id-2')
  })

  it('sets and retrieves fast model', () => {
    store.addConfig({ name: 'A', provider: 'openai', apiKey: 'k', model: 'gpt-4' })
    store.setFastModel({ configId: 'id-1', modelId: 'gpt-3.5' })
    const config = store.getFastModelConfig()
    assert.ok(config)
    assert.equal(config!.model, 'gpt-3.5')
  })

  it('fast model falls back to default when null', () => {
    store.addConfig({ name: 'A', provider: 'openai', apiKey: 'k', model: 'gpt-4' })
    store.setFastModel(null)
    const config = store.getFastModelConfig()
    assert.ok(config)
    assert.equal(config!.model, 'gpt-4')
  })

  it('strips apiKey when saving', () => {
    store.addConfig({ name: 'A', provider: 'openai', apiKey: 'secret' })
    const raw = storage.data.get('llm-config') as AIConfigStore
    assert.equal(raw.configs[0].apiKey, '')
  })

  it('respects MAX_CONFIG_COUNT', () => {
    for (let i = 0; i < 99; i++) {
      store.addConfig({ name: `C${i}`, provider: 'openai', apiKey: 'k' })
    }
    const result = store.addConfig({ name: 'Overflow', provider: 'openai', apiKey: 'k' })
    assert.equal(result.success, false)
    assert.ok(result.error)
  })

  it('calls onApiKeyCreated when adding config with key', () => {
    const captured: Array<{ name: string; key: string }> = []
    const storeWithHook = new LLMConfigStore(storage, {
      generateId: () => `id-${++idCounter}`,
      onApiKeyCreated: (config, apiKey) => {
        captured.push({ name: config.name, key: apiKey })
      },
    })
    storeWithHook.addConfig({ name: 'Hooked', provider: 'openai', apiKey: 'my-key' })
    assert.equal(captured.length, 1)
    assert.equal(captured[0].name, 'Hooked')
    assert.equal(captured[0].key, 'my-key')
  })

  it('persists authProfile from onApiKeyCreated return value on addConfig', () => {
    const storeWithAuth = new LLMConfigStore(storage, {
      generateId: () => `id-${++idCounter}`,
      onApiKeyCreated: (config) => {
        return config.name.toLowerCase().replace(/\s+/g, '-')
      },
      resolveApiKey: (_provider, authProfile) => {
        if (authProfile === 'my-openai') return 'resolved-key'
        return undefined
      },
    })

    storeWithAuth.addConfig({ name: 'My OpenAI', provider: 'openai', apiKey: 'sk-secret' })

    const raw = storage.data.get('llm-config') as AIConfigStore
    const savedConfig = raw.configs[0] as unknown as Record<string, unknown>
    assert.equal(savedConfig.authProfile, 'my-openai')
    assert.equal(savedConfig.apiKey, '', 'apiKey should be cleared on disk')

    const loaded = storeWithAuth.getAllConfigs()
    assert.equal(loaded[0].apiKey, 'resolved-key', 'resolveApiKey should use authProfile')
  })

  it('persists authProfile on updateConfig when key changes', () => {
    const storeWithAuth = new LLMConfigStore(storage, {
      generateId: () => `id-${++idCounter}`,
      onApiKeyCreated: (config) => {
        return config.name.toLowerCase().replace(/\s+/g, '-')
      },
    })

    storeWithAuth.addConfig({ name: 'Test Config', provider: 'openai', apiKey: 'sk-old' })
    storeWithAuth.updateConfig('id-1', { apiKey: 'sk-new' })

    const raw = storage.data.get('llm-config') as AIConfigStore
    const savedConfig = raw.configs[0] as unknown as Record<string, unknown>
    assert.equal(savedConfig.authProfile, 'test-config')
  })

  it('addConfig returns config with apiKey cleared', () => {
    const result = store.addConfig({ name: 'A', provider: 'openai', apiKey: 'sk-secret' })
    assert.ok(result.success)
    assert.equal(result.config!.apiKey, '', 'returned config should not leak apiKey')
  })

  it('calls onApiKeyDeleted with the deleted config when deleteConfig is called', () => {
    const deleted: AIServiceConfig[] = []
    const storeWithHook = new LLMConfigStore(storage, {
      generateId: () => `id-${++idCounter}`,
      onApiKeyCreated: (config) => {
        const name = config.name.toLowerCase().replace(/\s+/g, '-')
        ;(config as unknown as Record<string, unknown>).authProfile = name
        return name
      },
      onApiKeyDeleted: (config) => {
        deleted.push(config)
      },
    })
    storeWithHook.addConfig({ name: 'My Service', provider: 'openai', apiKey: 'sk-test' })
    const id = storeWithHook.getAllConfigs()[0].id
    storeWithHook.deleteConfig(id)
    assert.equal(deleted.length, 1, 'onApiKeyDeleted should be called once')
    assert.equal(
      (deleted[0] as unknown as Record<string, unknown>).authProfile,
      'my-service',
      'deleted config should retain authProfile for cleanup'
    )
    assert.equal(storeWithHook.getAllConfigs().length, 0, 'config should be removed')
  })

  it('does not call onApiKeyDeleted when another config still uses the same authProfile', () => {
    const deleted: string[] = []
    const storeWithHook = new LLMConfigStore(storage, {
      generateId: () => `id-${++idCounter}`,
      onApiKeyCreated: (config) => {
        const name = config.name.toLowerCase().replace(/\s+/g, '-')
        ;(config as unknown as Record<string, unknown>).authProfile = name
        return name
      },
      onApiKeyDeleted: (config) => {
        const profile = (config as unknown as Record<string, unknown>).authProfile as string | undefined
        if (profile) deleted.push(profile)
      },
    })

    storeWithHook.addConfig({ name: 'OpenAI', provider: 'openai', apiKey: 'sk-first' })
    storeWithHook.addConfig({ name: 'OpenAI', provider: 'openai', apiKey: 'sk-second' })

    storeWithHook.deleteConfig('id-1')

    assert.deepEqual(deleted, [], 'shared authProfile should stay available for remaining configs')
    assert.equal(
      (storage.data.get('llm-config') as AIConfigStore).configs.length,
      1,
      'only the deleted config should be removed'
    )
  })

  it('does not delete provider fallback profile still used by migrated legacy configs', () => {
    const deleted: string[] = []
    storage.data.set('llm-config', {
      configs: [
        {
          id: 'legacy-openai',
          name: 'Legacy OpenAI',
          provider: 'openai',
          apiKey: '',
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'explicit-openai',
          name: 'Explicit OpenAI',
          provider: 'openai',
          apiKey: '',
          ...({ authProfile: 'openai' } as Record<string, unknown>),
          createdAt: 2,
          updatedAt: 2,
        },
      ],
      defaultAssistant: { configId: 'legacy-openai', modelId: '' },
      fastModel: null,
    } as unknown as AIConfigStore)

    const storeWithHook = new LLMConfigStore(storage, {
      onApiKeyDeleted: (config) => {
        const profile = (config as unknown as Record<string, unknown>).authProfile as string | undefined
        if (profile) deleted.push(profile)
      },
    })

    storeWithHook.deleteConfig('explicit-openai')

    assert.deepEqual(deleted, [], 'provider fallback profile should stay available for legacy config')
  })

  it('calls onApiKeyDeleted for old profile when rename + key change causes profile name to change', () => {
    const deleted: string[] = []
    const storeWithHook = new LLMConfigStore(storage, {
      generateId: () => `id-${++idCounter}`,
      onApiKeyCreated: (config, _apiKey) => {
        const name = config.name.toLowerCase().replace(/\s+/g, '-')
        ;(config as unknown as Record<string, unknown>).authProfile = name
        return name
      },
      onApiKeyDeleted: (config) => {
        const profile = (config as unknown as Record<string, unknown>).authProfile as string | undefined
        if (profile) deleted.push(profile)
      },
    })
    storeWithHook.addConfig({ name: 'My OpenAI', provider: 'openai', apiKey: 'sk-old' })
    const id = storeWithHook.getAllConfigs()[0].id
    storeWithHook.updateConfig(id, { name: 'Work OpenAI', apiKey: 'sk-new' })
    assert.deepEqual(deleted, ['my-openai'], 'old profile should be cleaned up when profile name changes')
  })

  it('cleans old profile when profile replacement hook does not mutate the updated config', () => {
    const deleted: string[] = []
    const storeWithHook = new LLMConfigStore(storage, {
      generateId: () => `id-${++idCounter}`,
      onApiKeyCreated: (config, _apiKey) => {
        return config.name.toLowerCase().replace(/\s+/g, '-')
      },
      onApiKeyDeleted: (config) => {
        const profile = (config as unknown as Record<string, unknown>).authProfile as string | undefined
        if (profile) deleted.push(profile)
      },
    })

    storeWithHook.addConfig({ name: 'My OpenAI', provider: 'openai', apiKey: 'sk-old' })
    const id = storeWithHook.getAllConfigs()[0].id

    storeWithHook.updateConfig(id, { name: 'Work OpenAI', apiKey: 'sk-new' })

    assert.deepEqual(deleted, ['my-openai'], 'old profile should be cleaned up when no remaining config uses it')
  })

  it('does not delete old profile when saving updated config fails', () => {
    const deleted: string[] = []
    let failWrites = false
    const failingStorage: ConfigStorage = {
      readJson<T>(key: string): T | null {
        return (storage.data.get(key) as T) ?? null
      },
      writeJson<T>(key: string, value: T): void {
        if (failWrites) throw new Error('disk full')
        storage.data.set(key, JSON.parse(JSON.stringify(value)))
      },
    }
    storage.data.set('llm-config', {
      configs: [
        {
          id: 'cfg-1',
          name: 'Old OpenAI',
          provider: 'openai',
          apiKey: '',
          ...({ authProfile: 'old-openai' } as Record<string, unknown>),
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      defaultAssistant: { configId: 'cfg-1', modelId: '' },
      fastModel: null,
    } as unknown as AIConfigStore)
    const storeWithHook = new LLMConfigStore(failingStorage, {
      onApiKeyCreated: (config) => {
        return config.name.toLowerCase().replace(/\s+/g, '-')
      },
      onApiKeyDeleted: (config) => {
        const profile = (config as unknown as Record<string, unknown>).authProfile as string | undefined
        if (profile) deleted.push(profile)
      },
    })

    failWrites = true
    assert.throws(() => storeWithHook.updateConfig('cfg-1', { name: 'New OpenAI', apiKey: 'sk-new' }), /disk full/)

    assert.deepEqual(deleted, [], 'old profile should remain when config persistence fails')
  })

  it('does not call onApiKeyDeleted when key changes but profile name stays the same', () => {
    const deleted: string[] = []
    const storeWithHook = new LLMConfigStore(storage, {
      generateId: () => `id-${++idCounter}`,
      onApiKeyCreated: (config, _apiKey) => {
        const name = config.name.toLowerCase().replace(/\s+/g, '-')
        ;(config as unknown as Record<string, unknown>).authProfile = name
        return name
      },
      onApiKeyDeleted: (config) => {
        const profile = (config as unknown as Record<string, unknown>).authProfile as string | undefined
        if (profile) deleted.push(profile)
      },
    })
    storeWithHook.addConfig({ name: 'My OpenAI', provider: 'openai', apiKey: 'sk-old' })
    const id = storeWithHook.getAllConfigs()[0].id
    storeWithHook.updateConfig(id, { apiKey: 'sk-new' })
    assert.deepEqual(deleted, [], 'no cleanup needed when profile name is unchanged')
  })

  it('resolves correct key for same-provider configs with different authProfiles', () => {
    const profiles = new Map<string, string>()
    const storeWithAuth = new LLMConfigStore(storage, {
      generateId: () => `id-${++idCounter}`,
      onApiKeyCreated: (config, apiKey) => {
        const profileName = config.name.toLowerCase().replace(/\s+/g, '-')
        profiles.set(profileName, apiKey)
        return profileName
      },
      resolveApiKey: (_provider, authProfile) => {
        if (authProfile) return profiles.get(authProfile)
        return undefined
      },
    })

    storeWithAuth.addConfig({ name: 'Work OpenAI', provider: 'openai', apiKey: 'sk-work' })
    storeWithAuth.addConfig({ name: 'Personal OpenAI', provider: 'openai', apiKey: 'sk-personal' })

    const configs = storeWithAuth.getAllConfigs()
    assert.equal(configs.length, 2)
    assert.equal(configs[0].apiKey, 'sk-work')
    assert.equal(configs[1].apiKey, 'sk-personal')
  })
})
