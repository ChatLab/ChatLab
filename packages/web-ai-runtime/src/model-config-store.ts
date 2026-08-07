import type { SaveWebModelConfigInput, WebModelConfig } from './types'

const STORAGE_KEY = 'current-model'
const DATABASE_NAME = 'chatlab-web-ai'
const OBJECT_STORE_NAME = 'settings'

interface StoredModelBundle {
  config: WebModelConfig
  keyMaterial: string
  apiKeyCiphertext: string
  iv: string
}

export interface BrowserKeyValueStore {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
}

export function waitForIndexedDbTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    const rejectTransaction = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.oncomplete = () => resolve()
    transaction.onabort = rejectTransaction
    transaction.onerror = rejectTransaction
  })
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export class IndexedDbKeyValueStore implements BrowserKeyValueStore {
  private databasePromise: Promise<IDBDatabase> | undefined

  async get<T>(key: string): Promise<T | undefined> {
    const transaction = await this.transaction('readonly')
    return new Promise<T | undefined>((resolve, reject) => {
      const request = transaction.objectStore(OBJECT_STORE_NAME).get(key)
      request.onsuccess = () => resolve(request.result as T | undefined)
      request.onerror = () => reject(request.error)
    })
  }

  async set<T>(key: string, value: T): Promise<void> {
    const transaction = await this.transaction('readwrite')
    const completion = waitForIndexedDbTransaction(transaction)
    transaction.objectStore(OBJECT_STORE_NAME).put(value, key)
    await completion
  }

  async delete(key: string): Promise<void> {
    const transaction = await this.transaction('readwrite')
    const completion = waitForIndexedDbTransaction(transaction)
    transaction.objectStore(OBJECT_STORE_NAME).delete(key)
    await completion
  }

  private async transaction(mode: IDBTransactionMode): Promise<IDBTransaction> {
    const database = await (this.databasePromise ??= this.open())
    return database.transaction(OBJECT_STORE_NAME, mode)
  }

  private open(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is not available'))
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(OBJECT_STORE_NAME)) {
          request.result.createObjectStore(OBJECT_STORE_NAME)
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }
}

export class WebModelConfigStore {
  constructor(
    private readonly storage: BrowserKeyValueStore = new IndexedDbKeyValueStore(),
    private readonly cryptoProvider: Crypto = crypto
  ) {}

  async save(input: SaveWebModelConfigInput): Promise<WebModelConfig> {
    const apiKey = input.apiKey.trim()
    const existing = apiKey ? undefined : await this.storage.get<StoredModelBundle>(STORAGE_KEY)
    if (!apiKey && !existing) throw new Error('API key is required')
    const config: WebModelConfig = {
      provider: input.provider,
      baseURL: input.baseURL?.trim() || undefined,
      model: input.model.trim(),
      updatedAt: Date.now(),
    }
    if (existing) {
      await this.storage.set<StoredModelBundle>(STORAGE_KEY, { ...existing, config })
      return config
    }

    const key = await this.cryptoProvider.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ])
    const iv = this.cryptoProvider.getRandomValues(new Uint8Array(12))
    const plaintext = new TextEncoder().encode(apiKey)
    const ciphertext = await this.cryptoProvider.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
    const keyMaterial = await this.cryptoProvider.subtle.exportKey('raw', key)
    await this.storage.set<StoredModelBundle>(STORAGE_KEY, {
      config,
      keyMaterial: bytesToBase64(new Uint8Array(keyMaterial)),
      apiKeyCiphertext: bytesToBase64(new Uint8Array(ciphertext)),
      iv: bytesToBase64(iv),
    })
    return config
  }

  async getConfig(): Promise<WebModelConfig | null> {
    return (await this.storage.get<StoredModelBundle>(STORAGE_KEY))?.config ?? null
  }

  async getApiKey(): Promise<string | null> {
    const bundle = await this.storage.get<StoredModelBundle>(STORAGE_KEY)
    if (!bundle) return null
    const key = await this.cryptoProvider.subtle.importKey('raw', base64ToBytes(bundle.keyMaterial), 'AES-GCM', false, [
      'decrypt',
    ])
    const plaintext = await this.cryptoProvider.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(bundle.iv) },
      key,
      base64ToBytes(bundle.apiKeyCiphertext)
    )
    return new TextDecoder().decode(plaintext)
  }

  clear(): Promise<void> {
    return this.storage.delete(STORAGE_KEY)
  }
}
