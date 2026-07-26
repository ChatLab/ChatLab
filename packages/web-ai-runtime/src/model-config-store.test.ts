import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { describe, it } from 'node:test'

import { WebModelConfigStore, waitForIndexedDbTransaction, type BrowserKeyValueStore } from './model-config-store'

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

class RejectingKeyValueStore extends MemoryKeyValueStore {
  override async set(): Promise<void> {
    throw new Error('Browser storage is unavailable')
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
      updatedAt: (await store.getConfig())?.updatedAt,
    })
    assert.equal(await store.getApiKey(), 'second-secret')
    assert.doesNotMatch(JSON.stringify([...storage.values.values()]), /first-secret|second-secret/)

    await store.clear()
    assert.equal(await store.getConfig(), null)
    assert.equal(await store.getApiKey(), null)
  })

  it('surfaces browser storage failures without persisting a partial configuration', async () => {
    const store = new WebModelConfigStore(new RejectingKeyValueStore(), webcrypto as unknown as Crypto)

    await assert.rejects(
      store.save({ provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'temporary-test-secret' }),
      /Browser storage is unavailable/
    )
    assert.equal(await store.getConfig(), null)
  })
})

describe('waitForIndexedDbTransaction', () => {
  function createTransaction() {
    return {
      error: null as DOMException | null,
      oncomplete: null,
      onabort: null,
      onerror: null,
    } as unknown as IDBTransaction
  }

  it('waits for the transaction to commit instead of resolving after request success', async () => {
    const transaction = createTransaction()
    let settled = false
    const completion = waitForIndexedDbTransaction(transaction).finally(() => {
      settled = true
    })

    await Promise.resolve()
    assert.equal(settled, false)
    transaction.oncomplete?.call(transaction, new Event('complete'))
    await completion
    assert.equal(settled, true)
  })

  it('rejects when a transaction aborts after its request succeeded', async () => {
    const transaction = createTransaction()
    const completion = waitForIndexedDbTransaction(transaction)

    Object.defineProperty(transaction, 'error', { value: new DOMException('Quota exceeded', 'QuotaExceededError') })
    transaction.onabort?.call(transaction, new Event('abort'))
    await assert.rejects(completion, /Quota exceeded/)
  })
})
