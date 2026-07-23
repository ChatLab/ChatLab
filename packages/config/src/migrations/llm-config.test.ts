import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { m001LegacyToMultiConfig } from './m001-legacy-to-multi-config'
import { m002SchemaV2 } from './m002-schema-v2'
import { m003SchemaV3 } from './m003-schema-v3'
import { MigrationRunner } from './runner'

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

test('LLM config migrations use the shared locked storage path through schema v3', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-llm-config-migrations-'))
  const aiDataDir = path.join(dataDir, 'ai')
  const configPath = path.join(aiDataDir, 'llm-config.json')
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

  fs.mkdirSync(aiDataDir, { recursive: true })
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      provider: 'openai',
      apiKey: 'legacy-secret',
      model: 'gpt-test',
      disableThinking: true,
      isReasoningModel: true,
    }),
    'utf-8'
  )

  const runner = new MigrationRunner([m001LegacyToMultiConfig, m002SchemaV2, m003SchemaV3], {
    dataDir,
    aiDataDir,
    logger,
  })
  assert.deepEqual(await runner.run(), { executed: 3, currentVersion: 3 })

  const migrated = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
    schemaVersion: number
    configs: Array<Record<string, unknown>>
    defaultAssistant: { configId: string; modelId: string }
    fastModel: null
  }
  assert.equal(migrated.schemaVersion, 3)
  assert.equal(migrated.configs.length, 1)
  assert.equal(migrated.configs[0].apiKey, 'legacy-secret')
  assert.equal(migrated.configs[0].disableThinking, undefined)
  assert.equal(migrated.configs[0].isReasoningModel, undefined)
  assert.equal(migrated.defaultAssistant.configId, migrated.configs[0].id)
  assert.equal(migrated.defaultAssistant.modelId, 'gpt-test')
  assert.equal(migrated.fastModel, null)
  assert.deepEqual(
    fs
      .readdirSync(aiDataDir)
      .filter((name) => name.includes('.lock') || name.startsWith('.chatlab-lock-recovery-') || name.includes('.tmp-')),
    []
  )
})
