/**
 * Tests for LLM config API routes (US-010)
 *
 * Uses a temporary data directory to isolate tests from real data.
 * Tests provider listing, config CRUD, activation, has-config, and persistence.
 */

import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { Server } from 'node:http'

// Set up a temporary data directory BEFORE any app modules load
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-llm-test-'))
process.env.CHATLAB_DATA_DIR = tmpDir
// Use a fixed encryption key for deterministic tests
process.env.CHATLAB_ENCRYPTION_KEY = 'test-encryption-key-for-llm-tests'

import { createApp } from '../index.js'
import { _resetConfigPath } from '../ai/llm/index.js'
import { _resetKeyCache } from '../ai/llm/crypto.js'
import { getAiDataDir, ensureDir } from '../paths.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let server: Server
let baseUrl: string

function url(path: string): string {
  return `${baseUrl}${path}`
}

async function json(method: string, path: string, body?: unknown) {
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body !== undefined) {
    opts.body = JSON.stringify(body)
  }
  const res = await fetch(url(path), opts)
  const data = await res.json()
  return { status: res.status, data }
}

/**
 * Clear the config file between tests to ensure isolation.
 */
function clearConfigFile() {
  const configPath = path.join(getAiDataDir(), 'llm-config.json')
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath)
  }
  _resetConfigPath()
}

before(async () => {
  ensureDir(getAiDataDir())
  _resetKeyCache()
  const app = createApp()
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address()
      if (typeof addr === 'object' && addr) {
        baseUrl = `http://localhost:${addr.port}`
      }
      resolve()
    })
  })
})

after(() => {
  server?.close()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/llm/providers', () => {
  it('returns an array of provider objects', async () => {
    const { status, data } = await json('GET', '/api/llm/providers')
    assert.equal(status, 200)
    assert.ok(Array.isArray(data))
    assert.ok(data.length >= 7, 'should have at least 7 providers')
  })

  it('each provider has required fields', async () => {
    const { data } = await json('GET', '/api/llm/providers')
    for (const p of data) {
      assert.ok(p.id, 'provider must have id')
      assert.ok(p.name, 'provider must have name')
      assert.ok(p.defaultBaseUrl, 'provider must have defaultBaseUrl')
      assert.ok(Array.isArray(p.models), 'provider must have models array')
    }
  })

  it('contains deepseek provider', async () => {
    const { data } = await json('GET', '/api/llm/providers')
    const ds = data.find((p: { id: string }) => p.id === 'deepseek')
    assert.ok(ds, 'should contain deepseek provider')
    assert.ok(ds.models.length > 0, 'deepseek should have models')
  })
})

describe('GET /api/llm/has-config', () => {
  beforeEach(() => clearConfigFile())

  it('returns false when no config exists', async () => {
    const { status, data } = await json('GET', '/api/llm/has-config')
    assert.equal(status, 200)
    assert.equal(data.hasConfig, false)
  })

  it('returns true after adding a config', async () => {
    await json('POST', '/api/llm/configs', {
      name: 'Test Config',
      provider: 'deepseek',
      apiKey: 'sk-test-key-123',
    })
    const { data } = await json('GET', '/api/llm/has-config')
    assert.equal(data.hasConfig, true)
  })
})

describe('POST /api/llm/configs', () => {
  beforeEach(() => clearConfigFile())

  it('creates a new config and returns it', async () => {
    const { status, data } = await json('POST', '/api/llm/configs', {
      name: 'My DeepSeek',
      provider: 'deepseek',
      apiKey: 'sk-test-deepseek-key',
      model: 'deepseek-chat',
    })
    assert.equal(status, 201)
    assert.ok(data.id, 'should have an id')
    assert.equal(data.name, 'My DeepSeek')
    assert.equal(data.provider, 'deepseek')
    assert.equal(data.model, 'deepseek-chat')
    assert.ok(data.createdAt > 0)
    assert.ok(data.updatedAt > 0)
  })

  it('auto-activates the first config', async () => {
    await json('POST', '/api/llm/configs', {
      name: 'First',
      provider: 'deepseek',
      apiKey: 'key1',
    })
    const { data } = await json('GET', '/api/llm/has-config')
    assert.equal(data.hasConfig, true)
  })

  it('rejects missing name', async () => {
    const { status, data } = await json('POST', '/api/llm/configs', {
      provider: 'deepseek',
      apiKey: 'key',
    })
    assert.equal(status, 400)
    assert.ok(data.error.includes('name'))
  })

  it('rejects missing provider', async () => {
    const { status, data } = await json('POST', '/api/llm/configs', {
      name: 'Test',
      apiKey: 'key',
    })
    assert.equal(status, 400)
    assert.ok(data.error.includes('provider'))
  })

  it('rejects invalid provider', async () => {
    const { status, data } = await json('POST', '/api/llm/configs', {
      name: 'Test',
      provider: 'nonexistent',
      apiKey: 'key',
    })
    assert.equal(status, 400)
    assert.ok(data.error.includes('Invalid provider'))
  })

  it('allows config without apiKey (local API scenario)', async () => {
    const { status, data } = await json('POST', '/api/llm/configs', {
      name: 'Local Ollama',
      provider: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
    })
    assert.equal(status, 201)
    assert.equal(data.name, 'Local Ollama')
  })
})

describe('GET /api/llm/configs', () => {
  beforeEach(() => clearConfigFile())

  it('returns empty list when no configs exist', async () => {
    const { status, data } = await json('GET', '/api/llm/configs')
    assert.equal(status, 200)
    assert.deepEqual(data.configs, [])
    assert.equal(data.activeConfigId, null)
  })

  it('returns configs with masked API keys', async () => {
    await json('POST', '/api/llm/configs', {
      name: 'Test',
      provider: 'deepseek',
      apiKey: 'sk-abcdefghijklmnop',
    })
    const { data } = await json('GET', '/api/llm/configs')
    assert.equal(data.configs.length, 1)
    const config = data.configs[0]
    assert.ok(!config.apiKey.includes('abcdefghij'), 'API key should be masked')
    assert.ok(config.apiKey.includes('****'), 'masked key should contain ****')
  })

  it('returns activeConfigId', async () => {
    const { data: created } = await json('POST', '/api/llm/configs', {
      name: 'Active',
      provider: 'deepseek',
      apiKey: 'key',
    })
    const { data } = await json('GET', '/api/llm/configs')
    assert.equal(data.activeConfigId, created.id)
  })
})

describe('GET /api/llm/configs/:id', () => {
  beforeEach(() => clearConfigFile())

  it('returns a single config with masked API key', async () => {
    const { data: created } = await json('POST', '/api/llm/configs', {
      name: 'Single',
      provider: 'qwen',
      apiKey: 'sk-test-single-config',
    })
    const { status, data } = await json('GET', `/api/llm/configs/${created.id}`)
    assert.equal(status, 200)
    assert.equal(data.name, 'Single')
    assert.ok(data.apiKey.includes('****'))
  })

  it('returns 404 for nonexistent config', async () => {
    const { status } = await json('GET', '/api/llm/configs/nonexistent-id')
    assert.equal(status, 404)
  })
})

describe('PUT /api/llm/configs/:id', () => {
  beforeEach(() => clearConfigFile())

  it('updates config fields', async () => {
    const { data: created } = await json('POST', '/api/llm/configs', {
      name: 'Original',
      provider: 'deepseek',
      apiKey: 'key',
      model: 'deepseek-chat',
    })
    const { status } = await json('PUT', `/api/llm/configs/${created.id}`, {
      name: 'Updated',
      model: 'deepseek-coder',
    })
    assert.equal(status, 200)

    const { data: fetched } = await json('GET', `/api/llm/configs/${created.id}`)
    assert.equal(fetched.name, 'Updated')
    assert.equal(fetched.model, 'deepseek-coder')
  })

  it('returns 404 for nonexistent config', async () => {
    const { status } = await json('PUT', '/api/llm/configs/nonexistent-id', {
      name: 'Nope',
    })
    assert.equal(status, 404)
  })
})

describe('DELETE /api/llm/configs/:id', () => {
  beforeEach(() => clearConfigFile())

  it('deletes a config', async () => {
    const { data: created } = await json('POST', '/api/llm/configs', {
      name: 'To Delete',
      provider: 'deepseek',
      apiKey: 'key',
    })
    const { status } = await json('DELETE', `/api/llm/configs/${created.id}`)
    assert.equal(status, 200)

    const { data } = await json('GET', '/api/llm/configs')
    assert.equal(data.configs.length, 0)
  })

  it('clears activeConfigId when deleting active config', async () => {
    const { data: created } = await json('POST', '/api/llm/configs', {
      name: 'Only',
      provider: 'deepseek',
      apiKey: 'key',
    })
    await json('DELETE', `/api/llm/configs/${created.id}`)
    const { data } = await json('GET', '/api/llm/configs')
    assert.equal(data.activeConfigId, null)
  })

  it('promotes next config when deleting active', async () => {
    const { data: c1 } = await json('POST', '/api/llm/configs', {
      name: 'First',
      provider: 'deepseek',
      apiKey: 'key1',
    })
    const { data: c2 } = await json('POST', '/api/llm/configs', {
      name: 'Second',
      provider: 'qwen',
      apiKey: 'key2',
    })
    // First is active. Delete it.
    await json('DELETE', `/api/llm/configs/${c1.id}`)
    const { data } = await json('GET', '/api/llm/configs')
    assert.equal(data.activeConfigId, c2.id)
  })

  it('returns 404 for nonexistent config', async () => {
    const { status } = await json('DELETE', '/api/llm/configs/nonexistent-id')
    assert.equal(status, 404)
  })
})

describe('PUT /api/llm/configs/:id/activate', () => {
  beforeEach(() => clearConfigFile())

  it('activates a specific config', async () => {
    await json('POST', '/api/llm/configs', {
      name: 'First',
      provider: 'deepseek',
      apiKey: 'key1',
    })
    const { data: c2 } = await json('POST', '/api/llm/configs', {
      name: 'Second',
      provider: 'qwen',
      apiKey: 'key2',
    })
    const { status } = await json('PUT', `/api/llm/configs/${c2.id}/activate`)
    assert.equal(status, 200)

    const { data } = await json('GET', '/api/llm/configs')
    assert.equal(data.activeConfigId, c2.id)
  })

  it('returns 404 for nonexistent config', async () => {
    const { status } = await json('PUT', '/api/llm/configs/nonexistent-id/activate')
    assert.equal(status, 404)
  })
})

describe('Config persistence', () => {
  beforeEach(() => clearConfigFile())

  it('persists configs to a JSON file on disk', async () => {
    await json('POST', '/api/llm/configs', {
      name: 'Persistent',
      provider: 'deepseek',
      apiKey: 'sk-persistent-key',
    })
    const configPath = path.join(getAiDataDir(), 'llm-config.json')
    assert.ok(fs.existsSync(configPath), 'config file should exist on disk')

    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    assert.equal(raw.configs.length, 1)
    assert.equal(raw.configs[0].name, 'Persistent')
  })

  it('encrypts API keys in persisted file', async () => {
    await json('POST', '/api/llm/configs', {
      name: 'Encrypted',
      provider: 'deepseek',
      apiKey: 'sk-plaintext-key-value',
    })
    const configPath = path.join(getAiDataDir(), 'llm-config.json')
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    const storedKey = raw.configs[0].apiKey
    assert.ok(storedKey.startsWith('enc:'), 'stored API key should be encrypted')
    assert.ok(!storedKey.includes('sk-plaintext-key-value'), 'plaintext should not appear in file')
  })
})

describe('Config limit', () => {
  beforeEach(() => clearConfigFile())

  it('rejects creation when max config count is reached', async () => {
    // Create 10 configs (the maximum)
    for (let i = 0; i < 10; i++) {
      const { status } = await json('POST', '/api/llm/configs', {
        name: `Config ${i}`,
        provider: 'deepseek',
        apiKey: `key-${i}`,
      })
      assert.equal(status, 201, `config ${i} should be created`)
    }

    // 11th should fail
    const { status, data } = await json('POST', '/api/llm/configs', {
      name: 'Overflow',
      provider: 'deepseek',
      apiKey: 'key-overflow',
    })
    assert.equal(status, 400)
    assert.ok(data.error.includes('10'), 'error should mention the limit')
  })
})
