import assert from 'node:assert/strict'
import test from 'node:test'
import type { ConfigStorage } from './llm-config-store'
import { createAuthProfileLlmConfigStore } from './auth-profile-llm-config-store'

function createMemoryStorage(): ConfigStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  return {
    data,
    readJson: <T>(key: string) => (data.get(key) as T | undefined) ?? null,
    writeJson: <T>(key: string, value: T) => data.set(key, value),
  }
}

test('createAuthProfileLlmConfigStore shares auth-profile creation, resolution, and deletion wiring', () => {
  const storage = createMemoryStorage()
  const profiles = new Map<string, string>()
  const deleted: string[] = []
  const store = createAuthProfileLlmConfigStore(storage, {
    loadAuthProfiles: () => ({ version: 1, profiles: {} }),
    resolveApiKey: (_provider, profileName) => (profileName ? profiles.get(profileName) : undefined),
    writeAuthProfile: (name, profile) => profiles.set(name, profile.type === 'api_key' ? profile.key : ''),
    deleteAuthProfile: (name) => {
      profiles.delete(name)
      deleted.push(name)
    },
  })

  const added = store.addConfig({
    name: 'Team OpenAI',
    provider: 'openai',
    apiKey: 'secret-key',
    model: 'gpt-test',
  })

  assert.equal(added.success, true)
  const persisted = storage.data.get('llm-config') as { configs: Array<Record<string, unknown>> }
  const profileName = String(persisted.configs[0].authProfile)
  assert.equal(profiles.get(profileName), 'secret-key')
  assert.equal(persisted.configs[0].apiKey, '')
  assert.equal(store.getAllConfigs()[0].apiKey, 'secret-key')

  assert.equal(store.deleteConfig(added.config!.id).success, true)
  assert.deepEqual(deleted, [profileName])
})

test('createAuthProfileLlmConfigStore keeps API keys isolated when config names collide', () => {
  const storage = createMemoryStorage()
  const profiles = new Map<string, { type: 'api_key'; provider: string; key: string }>()
  const ids = ['config-a', 'config-b']
  const store = createAuthProfileLlmConfigStore(storage, {
    generateId: () => ids.shift()!,
    loadAuthProfiles: () => ({ version: 1, profiles: Object.fromEntries(profiles) }),
    resolveApiKey: (_provider, profileName) => (profileName ? profiles.get(profileName)?.key : undefined),
    writeAuthProfile: (name, profile) => profiles.set(name, profile),
  })

  const first = store.addConfig({
    name: 'Same Name',
    provider: 'openai-compatible',
    apiKey: 'KEY_A',
    model: 'model-a',
  })
  const second = store.addConfig({
    name: 'Same Name',
    provider: 'openai-compatible',
    apiKey: 'KEY_B',
    model: 'model-b',
  })

  assert.equal(first.success, true)
  assert.equal(second.success, true)
  assert.deepEqual(
    store.getAllConfigs().map((config) => config.apiKey),
    ['KEY_A', 'KEY_B']
  )
})
