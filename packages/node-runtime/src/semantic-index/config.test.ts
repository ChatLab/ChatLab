import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  SemanticIndexConfigStore,
  canRunSemanticIndex,
  defaultSemanticIndexConfig,
  resolveModelId,
  type SemanticIndexConfig,
} from './config'

function tempConfigPath(): string {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
  const dir = fs.mkdtempSync(path.join(baseDir, 'chatlab-si-config-'))
  return path.join(dir, 'ai', 'semantic-index-config.json')
}

test('default config is enabled with no model preselected', () => {
  const store = new SemanticIndexConfigStore(tempConfigPath())
  const config = store.get()
  assert.equal(config.mode, 'local')
  assert.equal(config.enabled, true)
  assert.equal(config.local.modelId, '')
  assert.equal(config.local.downloadSource, 'huggingface')
  assert.equal(config.api, null)
})

test('isConfigured is false until a model is chosen', () => {
  const store = new SemanticIndexConfigStore(tempConfigPath())
  assert.equal(store.isConfigured(), false)
  // 仅切换全局开关不算已选模型
  store.setEnabled(false)
  assert.equal(store.isConfigured(), false)
  assert.equal(store.isEnabled(), false)
  // 选择本地模型后才算已配置
  store.set({ ...store.get(), enabled: true, local: { modelId: 'local-test' } })
  assert.equal(store.isConfigured(), true)
  assert.equal(store.isEnabled(), true)
})

test('canRunSemanticIndex requires both enabled switch and explicit model config', () => {
  assert.equal(canRunSemanticIndex(defaultSemanticIndexConfig()), false)
  assert.equal(
    canRunSemanticIndex({
      ...defaultSemanticIndexConfig(),
      local: { modelId: 'local-test' },
    }),
    true
  )
  assert.equal(
    canRunSemanticIndex({
      ...defaultSemanticIndexConfig(),
      enabled: false,
      local: { modelId: 'local-test' },
    }),
    false
  )
  assert.equal(
    canRunSemanticIndex({
      ...defaultSemanticIndexConfig(),
      mode: 'api',
      api: { baseUrl: 'https://api.example.com/v1', model: 'text-embed' },
    }),
    true
  )
})

test('old config without enabled field defaults to enabled', () => {
  const filePath = tempConfigPath()
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify({ version: 1, mode: 'local', local: { modelId: 'm' }, api: null }))
  const store = new SemanticIndexConfigStore(filePath)
  assert.equal(store.isEnabled(), true)
  assert.equal(store.isConfigured(), true)
  assert.equal(store.get().local.downloadSource, 'huggingface')
})

test('set then get roundtrips and creates directory', () => {
  const store = new SemanticIndexConfigStore(tempConfigPath())
  const next: SemanticIndexConfig = {
    version: 1,
    enabled: true,
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

test('local model download source roundtrips without changing model identity', () => {
  const store = new SemanticIndexConfigStore(tempConfigPath())
  const official = {
    ...defaultSemanticIndexConfig(),
    local: { modelId: 'local-test', downloadSource: 'huggingface' as const },
  }
  const mirror = {
    ...official,
    local: { ...official.local, downloadSource: 'hf-mirror' as const },
  }

  store.set(mirror)

  assert.equal(store.get().local.downloadSource, 'hf-mirror')
  assert.equal(resolveModelId(official), resolveModelId(mirror))
})

test('resolveModelId reflects local model id', () => {
  const config = { ...defaultSemanticIndexConfig(), local: { modelId: 'local-test' } }
  assert.equal(resolveModelId(config), 'local-test')
})

test('resolveModelId for api combines baseUrl and model', () => {
  const config: SemanticIndexConfig = {
    version: 1,
    enabled: true,
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
    enabled: true,
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
    enabled: true,
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
