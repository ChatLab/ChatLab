import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import type { AuthProfile } from '@openchatlab/config'
import { createFileConfigStorage } from './file-config-storage'
import { createLlmRuntimeStores } from './llm-runtime-stores'

function runConfigWriterWorker(aiDataDir: string, workerIndex: number, count: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let completed = false
    const worker = new Worker(
      `
        const { parentPort, workerData } = require('node:worker_threads')
        ;(async () => {
          require('tsx/cjs/api').register()
          const { createLlmRuntimeStores } = require(workerData.modulePath)
          const { llmConfigStore } = createLlmRuntimeStores(workerData.aiDataDir)
          for (let index = 0; index < workerData.count; index++) {
            const result = llmConfigStore.addConfig({
              name: \`worker-\${workerData.workerIndex}-\${index}\`,
              provider: 'openai',
              apiKey: '',
            })
            if (!result.success) throw new Error(result.error || 'Failed to add config')
          }
          parentPort.postMessage('done')
        })().catch((error) => {
          throw error
        })
      `,
      {
        eval: true,
        workerData: {
          aiDataDir,
          count,
          modulePath: fileURLToPath(new URL('./llm-runtime-stores.ts', import.meta.url)),
          workerIndex,
        },
      }
    )
    worker.once('message', () => {
      completed = true
    })
    worker.once('error', reject)
    worker.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Config writer worker exited with code ${code}`))
      } else if (!completed) {
        reject(new Error('Config writer worker exited before completing'))
      } else {
        resolve()
      }
    })
  })
}

test('createLlmRuntimeStores shares configs and catalogs without persisting API keys', (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-llm-runtime-stores-'))
  const aiDataDir = path.join(rootDir, 'ai')
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }))

  const profiles = new Map<string, AuthProfile>([
    ['shared-openai', { type: 'api_key', provider: 'openai', key: 'existing-secret' }],
  ])
  const deletedProfiles: string[] = []
  const authProfileDeps = {
    resolveApiKey: (_provider: string, profileName?: string) =>
      profileName && profiles.get(profileName)?.type === 'api_key'
        ? (profiles.get(profileName) as Extract<AuthProfile, { type: 'api_key' }>).key
        : undefined,
    writeAuthProfile: (name: string, profile: AuthProfile) => profiles.set(name, profile),
    deleteAuthProfile: (name: string) => {
      profiles.delete(name)
      deletedProfiles.push(name)
    },
  }

  const storage = createFileConfigStorage(aiDataDir)
  storage.writeJson('llm-config', {
    configs: [
      {
        id: 'existing-config',
        name: 'Existing OpenAI',
        provider: 'openai',
        apiKey: '',
        authProfile: 'shared-openai',
        model: 'fixture-custom-model',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    defaultAssistant: { configId: 'existing-config', modelId: 'fixture-custom-model' },
    fastModel: null,
  })

  const firstRuntime = createLlmRuntimeStores(aiDataDir, {
    authProfileDeps,
    generateId: () => 'second-config',
  })
  const secondRuntime = createLlmRuntimeStores(aiDataDir, { authProfileDeps })

  assert.equal(firstRuntime.llmConfigStore.getDefaultAssistantConfig()?.apiKey, 'existing-secret')
  assert.equal(secondRuntime.llmConfigStore.getDefaultAssistantConfig()?.apiKey, 'existing-secret')
  assert.equal(
    secondRuntime.customModelStore
      .getAll()
      .filter((model) => model.providerId === 'openai' && model.id === 'fixture-custom-model').length,
    1
  )

  const customProvider = firstRuntime.customProviderStore.add({
    name: 'Shared Provider',
    defaultBaseUrl: 'https://example.com/v1',
  })
  assert.equal(
    secondRuntime.customProviderStore.getAll().find((provider) => provider.id === customProvider.id)?.name,
    'Shared Provider'
  )

  const added = firstRuntime.llmConfigStore.addConfig({
    name: 'Second OpenAI',
    provider: 'openai',
    apiKey: 'new-secret',
    model: 'gpt-4.1',
  })
  assert.equal(added.success, true)
  assert.equal(secondRuntime.llmConfigStore.getConfigById('second-config')?.apiKey, 'new-secret')

  const persisted = storage.readJson<{ configs: Array<Record<string, unknown>> }>('llm-config')
  const persistedSecondConfig = persisted?.configs.find((config) => config.id === 'second-config')
  assert.equal(persistedSecondConfig?.apiKey, '')
  assert.equal(persistedSecondConfig?.authProfile, 'second-openai')

  assert.equal(secondRuntime.llmConfigStore.deleteConfig('second-config').success, true)
  assert.deepEqual(deletedProfiles, ['second-openai'])
  assert.equal(firstRuntime.llmConfigStore.getConfigById('second-config'), null)
})

test('createLlmRuntimeStores resolves distinct legacy profiles for configs from the same provider', (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-llm-runtime-legacy-profiles-'))
  const aiDataDir = path.join(rootDir, 'ai')
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }))

  createFileConfigStorage(aiDataDir).writeJson('llm-config', {
    configs: [
      {
        id: 'primary',
        name: 'Primary',
        provider: 'deepseek',
        apiKey: '',
        model: 'deepseek-chat',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'backup',
        name: 'Backup',
        provider: 'deepseek',
        apiKey: '',
        model: 'deepseek-chat',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    defaultAssistant: { configId: 'primary', modelId: 'deepseek-chat' },
    fastModel: { configId: 'backup', modelId: 'deepseek-chat' },
  })

  const profiles: Record<string, AuthProfile> = {
    deepseek: { type: 'api_key', provider: 'deepseek', key: 'primary-secret' },
    'deepseek-2': { type: 'api_key', provider: 'deepseek', key: 'backup-secret' },
  }
  const runtime = createLlmRuntimeStores(aiDataDir, {
    authProfileDeps: {
      loadAuthProfiles: () => ({ version: 1, profiles }),
      resolveApiKey: (provider, profileName) => {
        if (profileName) return profiles[profileName]?.key
        return Object.values(profiles).find((profile) => profile.provider === provider)?.key
      },
    },
  })

  const configs = runtime.llmConfigStore.getAllConfigs()
  assert.deepEqual(
    configs.map((config) => ({
      id: config.id,
      authProfile: (config as unknown as Record<string, unknown>).authProfile,
      apiKey: config.apiKey,
    })),
    [
      { id: 'primary', authProfile: 'deepseek', apiKey: 'primary-secret' },
      { id: 'backup', authProfile: 'deepseek-2', apiKey: 'backup-secret' },
    ]
  )
})

test('createLlmRuntimeStores restores name-based profile references written by legacy runtime stores', (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-llm-runtime-named-profiles-'))
  const aiDataDir = path.join(rootDir, 'ai')
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }))

  createFileConfigStorage(aiDataDir).writeJson('llm-config', {
    configs: [
      {
        id: 'work',
        name: 'Work OpenAI',
        provider: 'openai',
        apiKey: '',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'personal',
        name: 'Personal OpenAI',
        provider: 'openai',
        apiKey: '',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    defaultAssistant: { configId: 'work', modelId: '' },
    fastModel: { configId: 'personal', modelId: '' },
  })

  const profiles: Record<string, AuthProfile> = {
    'work-openai': { type: 'api_key', provider: 'openai', key: 'work-secret' },
    'personal-openai': { type: 'api_key', provider: 'openai', key: 'personal-secret' },
  }
  const runtime = createLlmRuntimeStores(aiDataDir, {
    authProfileDeps: {
      loadAuthProfiles: () => ({ version: 1, profiles }),
      resolveApiKey: (_provider, profileName) => (profileName ? profiles[profileName]?.key : undefined),
    },
  })

  assert.deepEqual(
    runtime.llmConfigStore.getAllConfigs().map((config) => ({
      authProfile: (config as unknown as Record<string, unknown>).authProfile,
      apiKey: config.apiKey,
    })),
    [
      { authProfile: 'work-openai', apiKey: 'work-secret' },
      { authProfile: 'personal-openai', apiKey: 'personal-secret' },
    ]
  )
})

test('createLlmRuntimeStores serializes concurrent config writes across runtime instances', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-llm-runtime-concurrent-'))
  const aiDataDir = path.join(rootDir, 'ai')
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }))

  const workerCount = 4
  const configsPerWorker = 20
  await Promise.all(
    Array.from({ length: workerCount }, (_, workerIndex) =>
      runConfigWriterWorker(aiDataDir, workerIndex, configsPerWorker)
    )
  )

  const configs = createLlmRuntimeStores(aiDataDir).llmConfigStore.getAllConfigs()
  assert.equal(configs.length, workerCount * configsPerWorker)
  assert.equal(new Set(configs.map((config) => config.name)).size, workerCount * configsPerWorker)
  assert.deepEqual(
    fs
      .readdirSync(aiDataDir)
      .filter((name) => name.includes('.lock') || name.startsWith('.chatlab-lock-recovery-') || name.includes('.tmp-')),
    []
  )
})
