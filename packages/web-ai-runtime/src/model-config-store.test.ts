import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { describe, it } from 'node:test'

import { WebModelConfigStore, type BrowserKeyValueStore } from './model-config-store'

class MemoryKeyValueStore implements BrowserKeyValueStore {
  readonly values = new Map<string, unknown>()

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value))
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key)
  }
}

describe('WebModelConfigStore', () => {
  it('round-trips a model config without storing the API key as plaintext', async () => {
    const storage = new MemoryKeyValueStore()
    const store = new WebModelConfigStore(storage, webcrypto as unknown as Crypto)

    const config = await store.save({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      apiKey: 'temporary-test-secret',
    })

    assert.equal(config.model, 'deepseek-v4-flash')
    assert.equal(await store.getApiKey(), 'temporary-test-secret')
    assert.doesNotMatch(JSON.stringify([...storage.values.values()]), /temporary-test-secret/)
  })

  it('atomically replaces and clears the current model bundle', async () => {
    const storage = new MemoryKeyValueStore()
    const store = new WebModelConfigStore(storage, webcrypto as unknown as Crypto)
    await store.save({ provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'first-secret' })
    await store.save({
      provider: 'openai-compatible',
      baseURL: 'https://example.invalid/v1/',
      model: 'custom-model',
      apiKey: 'second-secret',
    })

    assert.deepEqual(await store.getConfig(), {
      provider: 'openai-compatible',
      baseURL: 'https://example.invalid/v1/',
      model: 'custom-model',
      contextWindow: undefined,
      updatedAt: (await store.getConfig())?.updatedAt,
    })
    assert.equal(await store.getApiKey(), 'second-secret')
    assert.doesNotMatch(JSON.stringify([...storage.values.values()]), /first-secret|second-secret/)

    await store.clear()
    assert.equal(await store.getConfig(), null)
    assert.equal(await store.getApiKey(), null)
  })
})
