import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  SemanticIndexConfigStore,
  defaultSemanticIndexConfig,
  resolveModelId,
  type SemanticIndexConfig,
} from './config'

function tempConfigPath(): string {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
  const dir = fs.mkdtempSync(path.join(baseDir, 'chatlab-si-config-'))
  return path.join(dir, 'ai', 'semantic-index-config.json')
}

test('returns default config when file missing', () => {
  const store = new SemanticIndexConfigStore(tempConfigPath())
  const config = store.get()
  assert.equal(config.mode, 'local')
  assert.ok(config.local.modelId.length > 0)
  assert.equal(config.api, null)
})

test('set then get roundtrips and creates directory', () => {
  const store = new SemanticIndexConfigStore(tempConfigPath())
  const next: SemanticIndexConfig = {
    version: 1,
    mode: 'api',
    local: { modelId: 'x' },
    api: { baseUrl: 'https://api.example.com/v1', model: 'text-embed', authProfile: 'p1', dim: 1024 },
    searchMaxResults: 5,
  }
  store.set(next)
  const loaded = store.get()
  assert.equal(loaded.mode, 'api')
  assert.equal(loaded.api?.baseUrl, 'https://api.example.com/v1')
  assert.equal(loaded.api?.model, 'text-embed')
  assert.equal(loaded.api?.authProfile, 'p1')
})

test('resolveModelId reflects local model id', () => {
  const config = { ...defaultSemanticIndexConfig(), local: { modelId: 'bge-test' } }
  assert.equal(resolveModelId(config), 'bge-test')
})

test('resolveModelId for api combines baseUrl and model', () => {
  const config: SemanticIndexConfig = {
    version: 1,
    mode: 'api',
    local: { modelId: 'x' },
    api: { baseUrl: 'https://h/v1', model: 'm1' },
    searchMaxResults: 5,
  }
  assert.equal(resolveModelId(config), 'api:https://h/v1#m1')
})

test('changing only api key (authProfile) keeps model identity stable (no rebuild)', () => {
  const a: SemanticIndexConfig = {
    version: 1,
    mode: 'api',
    local: { modelId: 'x' },
    api: { baseUrl: 'https://h/v1', model: 'm1', authProfile: 'p1' },
    searchMaxResults: 5,
  }
  const b: SemanticIndexConfig = { ...a, api: { ...a.api!, authProfile: 'p2' } }
  assert.equal(resolveModelId(a), resolveModelId(b))
})

test('changing api model changes identity (rebuild needed)', () => {
  const a: SemanticIndexConfig = {
    version: 1,
    mode: 'api',
    local: { modelId: 'x' },
    api: { baseUrl: 'https://h/v1', model: 'm1' },
    searchMaxResults: 5,
  }
  const b: SemanticIndexConfig = { ...a, api: { ...a.api!, model: 'm2' } }
  assert.notEqual(resolveModelId(a), resolveModelId(b))
})

test('malformed config file falls back to default', () => {
  const filePath = tempConfigPath()
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, '{ not json')
  const store = new SemanticIndexConfigStore(filePath)
  assert.equal(store.get().mode, 'local')
})
