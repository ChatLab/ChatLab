import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { PreferencesManager } from './preferences'

function createTempSystemDir(): string {
  return mkdtempSync(join(tmpdir(), 'chatlab-preferences-'))
}

function readPreferencesFile(systemDir: string): any {
  return JSON.parse(readFileSync(join(systemDir, 'preferences.json'), 'utf-8'))
}

test('migrates old built-in desensitize rules out of preferences with a backup', () => {
  const systemDir = createTempSystemDir()
  try {
    writeFileSync(
      join(systemDir, 'preferences.json'),
      JSON.stringify({
        aiPreprocessConfig: {
          desensitizeRules: [
            {
              id: 'api_key_prefix',
              label: 'API Key',
              pattern: 'sk-[A-Za-z0-9]+',
              replacement: '[API Key]',
              enabled: false,
              builtin: true,
              locales: [],
            },
            {
              id: 'custom_staff_id',
              label: 'Staff ID',
              pattern: 'EMP-\\d+',
              replacement: '[Staff ID]',
              enabled: true,
              builtin: false,
              locales: [],
            },
          ],
        },
      })
    )

    const prefs = new PreferencesManager(systemDir).load()
    const saved = readPreferencesFile(systemDir)
    const backupsDir = join(systemDir, 'backups')

    assert.equal(prefs.aiPreprocessConfig.desensitizeRulesSchemaVersion, 2)
    assert.deepEqual(prefs.aiPreprocessConfig.desensitizeBuiltinRuleOverrides, {})
    assert.deepEqual(
      prefs.aiPreprocessConfig.desensitizeRules.map((rule) => rule.id),
      ['custom_staff_id']
    )
    assert.equal(saved.aiPreprocessConfig.desensitizeRules[0].id, 'custom_staff_id')
    assert.equal(
      saved.aiPreprocessConfig.desensitizeRules.some((rule: any) => rule.builtin),
      false
    )
    assert.equal(existsSync(backupsDir), true)
    assert.equal(
      readdirSync(backupsDir).some((name) => name.startsWith('preferences-pre-desensitize-groups-')),
      true
    )
  } finally {
    rmSync(systemDir, { recursive: true, force: true })
  }
})

test('sanitizes built-in desensitize rule bodies on save', () => {
  const systemDir = createTempSystemDir()
  try {
    const manager = new PreferencesManager(systemDir)
    const result = manager.save({
      aiPreprocessConfig: {
        dataCleaning: true,
        mergeConsecutive: true,
        mergeWindowSeconds: 180,
        blacklistKeywords: [],
        denoise: true,
        desensitize: true,
        anonymizeNames: false,
        desensitizeRulesSchemaVersion: 2,
        desensitizeBuiltinRuleOverrides: {
          api_key_prefix: true,
          url: false,
        },
        desensitizeRules: [
          {
            id: 'api_key_prefix',
            label: 'API Key',
            pattern: 'sk-[A-Za-z0-9]+',
            replacement: '[API Key]',
            enabled: true,
            builtin: true,
            locales: [],
          },
          {
            id: 'custom_staff_id',
            label: 'Staff ID',
            pattern: 'EMP-\\d+',
            replacement: '[Staff ID]',
            enabled: true,
            builtin: false,
            locales: [],
          },
        ],
      },
    })

    const saved = readPreferencesFile(systemDir)

    assert.equal(result.success, true)
    assert.deepEqual(saved.aiPreprocessConfig.desensitizeBuiltinRuleOverrides, {
      api_key_prefix: true,
      url: false,
    })
    assert.deepEqual(
      saved.aiPreprocessConfig.desensitizeRules.map((rule: any) => rule.id),
      ['custom_staff_id']
    )
    assert.equal(JSON.stringify(saved).includes('sk-[A-Za-z0-9]+'), false)
  } finally {
    rmSync(systemDir, { recursive: true, force: true })
  }
})
