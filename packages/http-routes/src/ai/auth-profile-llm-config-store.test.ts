import assert from 'node:assert/strict'
import test from 'node:test'
import type { ConfigStorage } from '@openchatlab/node-runtime'
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
  assert.equal(profiles.get('team-openai'), 'secret-key')
  const persisted = storage.data.get('llm-config') as { configs: Array<Record<string, unknown>> }
  assert.equal(persisted.configs[0].apiKey, '')
  assert.equal(persisted.configs[0].authProfile, 'team-openai')
  assert.equal(store.getAllConfigs()[0].apiKey, 'secret-key')

  assert.equal(store.deleteConfig(added.config!.id).success, true)
  assert.deepEqual(deleted, ['team-openai'])
})
