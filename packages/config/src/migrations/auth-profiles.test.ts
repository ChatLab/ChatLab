import assert from 'node:assert/strict'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { after, beforeEach, describe, it } from 'node:test'

const tempHome = mkdtempSync(join(tmpdir(), 'chatlab-config-migration-'))
const originalHome = process.env.HOME
process.env.HOME = tempHome

const [{ m004EncryptedKeysToAuthProfiles }, { MigrationRunner }, { getApiKeyByProfile, loadAuthProfiles }] =
  await Promise.all([import('./m004-encrypted-keys-to-auth-profiles'), import('./runner'), import('../auth-profiles')])

const chatlabDir = join(tempHome, '.chatlab')
const aiDataDir = join(chatlabDir, 'ai')

function createLogger() {
  const infos: string[] = []
  const warnings: string[] = []
  const errors: string[] = []

  return {
    infos,
    warnings,
    errors,
    logger: {
      info(_category: string, message: string) {
        infos.push(message)
      },
      warn(_category: string, message: string) {
        warnings.push(message)
      },
      error(_category: string, message: string) {
        errors.push(message)
      },
    },
  }
}

async function writeLlmConfig(configs: Array<Record<string, unknown>>): Promise<void> {
  await mkdir(aiDataDir, { recursive: true })
  await writeFile(join(aiDataDir, 'llm-config.json'), JSON.stringify({ version: 3, configs }, null, 2), 'utf-8')
}

function readLlmConfig(): { configs: Array<Record<string, unknown>> } {
  return JSON.parse(readFileSync(join(aiDataDir, 'llm-config.json'), 'utf-8')) as {
    configs: Array<Record<string, unknown>>
  }
}

function encryptWithDeviceKey(plainText: string, deviceKey: string): string {
  const key = createHash('sha256')
    .update(deviceKey + 'chatlab-api-key-encryption-v1')
    .digest()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  let encrypted = cipher.update(plainText, 'utf8', 'base64')
  encrypted += cipher.final('base64')
  const authTag = cipher.getAuthTag()
  return `enc:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`
}

beforeEach(async () => {
  await rm(chatlabDir, { recursive: true, force: true })
})

after(() => {
  if (originalHome === undefined) {
    delete process.env.HOME
  } else {
    process.env.HOME = originalHome
  }
  rmSync(tempHome, { recursive: true, force: true })
})

describe('m004 encrypted keys to auth profiles migration', () => {
  it('migrates plaintext keys through the runner, deduplicates profile names, and clears old apiKey fields', async () => {
    await writeLlmConfig([
      { name: 'DeepSeek Main', provider: 'deepseek', apiKey: 'plain-one' },
      { name: 'DeepSeek Backup', provider: 'deepseek', apiKey: 'plain-two' },
      {
        name: 'OpenAI Compatible',
        provider: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'plain-three',
      },
    ])

    const { logger } = createLogger()
    const runner = new MigrationRunner([m004EncryptedKeysToAuthProfiles], {
      dataDir: chatlabDir,
      aiDataDir,
      logger,
    })

    assert.deepEqual(await runner.run(), { executed: 1, currentVersion: 4 })

    const profiles = loadAuthProfiles().profiles
    assert.equal(profiles.deepseek.key, 'plain-one')
    assert.equal(profiles['deepseek-2'].key, 'plain-two')
    assert.equal(profiles['api.example.com'].key, 'plain-three')
    assert.equal(getApiKeyByProfile('deepseek'), 'plain-one')
    assert.deepEqual(
      readLlmConfig().configs.map((config) => config.apiKey),
      ['', '', '']
    )
    assert.deepEqual(
      readLlmConfig().configs.map((config) => config.authProfile),
      ['deepseek', 'deepseek-2', 'api.example.com']
    )
    assert.equal(readFileSync(join(chatlabDir, '.migration-version'), 'utf-8'), '4')
  })

  it('decrypts legacy device-key encrypted api keys into auth profiles', async () => {
    const deviceKey = '0123456789abcdef0123456789abcdef'
    await mkdir(chatlabDir, { recursive: true })
    await writeFile(join(chatlabDir, '.device-key'), deviceKey, 'utf-8')
    await writeLlmConfig([
      { name: 'Anthropic', provider: 'anthropic', apiKey: encryptWithDeviceKey('secret-key', deviceKey) },
    ])

    const { logger } = createLogger()
    await m004EncryptedKeysToAuthProfiles.up({ dataDir: chatlabDir, aiDataDir, logger })

    assert.equal(getApiKeyByProfile('anthropic'), 'secret-key')
    assert.equal(readLlmConfig().configs[0].apiKey, '')
  })

  it('does not create an auth profile or clear apiKey when encrypted key decryption fails', async () => {
    await writeLlmConfig([{ name: 'Google', provider: 'google', apiKey: 'enc:not:a:valid-key' }])

    const { logger, warnings } = createLogger()
    await m004EncryptedKeysToAuthProfiles.up({ dataDir: chatlabDir, aiDataDir, logger })

    assert.equal(existsSync(join(chatlabDir, 'auth-profiles.json')), false)
    assert.equal(loadAuthProfiles().profiles.google, undefined)
    assert.equal(readLlmConfig().configs[0].apiKey, 'enc:not:a:valid-key')
    assert.equal(warnings.length, 1)
  })
})
