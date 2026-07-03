import { describe, it, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { preprocessMessages, type PreprocessableMessage } from '@openchatlab/node-runtime'
import { resolveCliLocale, loadCliPreprocessConfig } from './preprocess-config'

const tempDir = mkdtempSync(join(tmpdir(), 'chatlab-cli-preprocess-'))

beforeEach(() => {
  rmSync(join(tempDir, 'preferences.json'), { force: true })
})

after(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function msg(content: string): PreprocessableMessage {
  return { id: 1, senderName: 'A', content, timestamp: 1000 }
}

describe('resolveCliLocale', () => {
  it('prefers config locale.lang over system locale', () => {
    assert.equal(resolveCliLocale('en-US', 'zh-CN'), 'en-US')
  })

  it('normalizes language variants to builtin rule locales', () => {
    assert.equal(resolveCliLocale('zh-Hans-CN'), 'zh-CN')
    assert.equal(resolveCliLocale('', 'en-GB'), 'en-US')
    assert.equal(resolveCliLocale('', 'ja'), 'ja-JP')
    assert.equal(resolveCliLocale('', 'ko'), 'ko-KR')
  })

  it('keeps unknown locales as-is (generic rules still apply)', () => {
    assert.equal(resolveCliLocale('fr-FR'), 'fr-FR')
  })

  it('falls back to zh-CN when nothing is available', () => {
    assert.equal(resolveCliLocale('', ''), 'zh-CN')
  })
})

describe('loadCliPreprocessConfig', () => {
  it('merges builtin desensitize rules even when user rules are empty (zh-CN)', () => {
    const config = loadCliPreprocessConfig(tempDir, 'zh-CN')

    assert.equal(config.desensitize, true)
    assert.ok(config.desensitizeRules.some((r) => r.id === 'cn_phone'))
    assert.ok(config.desensitizeRules.some((r) => r.id === 'email'))

    const result = preprocessMessages([msg('我的手机号是13812345678，邮箱 test@example.com')], config)
    assert.ok(result[0].content?.includes('[手机号]'))
    assert.ok(result[0].content?.includes('[Email]'))
  })

  it('applies en-US builtin rules and excludes cn-only rules', () => {
    const config = loadCliPreprocessConfig(tempDir, 'en-US')

    assert.ok(config.desensitizeRules.some((r) => r.id === 'us_ssn'))
    assert.equal(
      config.desensitizeRules.some((r) => r.id === 'cn_phone'),
      false
    )

    const result = preprocessMessages([msg('my ssn is 123-45-6789 ok')], config)
    assert.ok(result[0].content?.includes('[SSN]'))
  })

  it('preserves user custom rules alongside builtin rules', () => {
    writeFileSync(
      join(tempDir, 'preferences.json'),
      JSON.stringify({
        aiPreprocessConfig: {
          desensitizeRules: [
            {
              id: 'custom_project',
              label: 'Project code',
              pattern: 'ProjectX',
              replacement: '[项目]',
              enabled: true,
              builtin: false,
              locales: [],
            },
          ],
        },
      }),
      'utf-8'
    )

    const config = loadCliPreprocessConfig(tempDir, 'zh-CN')
    assert.ok(config.desensitizeRules.some((r) => r.id === 'custom_project'))
    assert.ok(config.desensitizeRules.some((r) => r.id === 'cn_phone'))

    const result = preprocessMessages([msg('ProjectX 上线了，电话13812345678')], config)
    assert.ok(result[0].content?.includes('[项目]'))
    assert.ok(result[0].content?.includes('[手机号]'))
  })

  it('respects builtin rule overrides from preferences', () => {
    writeFileSync(
      join(tempDir, 'preferences.json'),
      JSON.stringify({
        aiPreprocessConfig: {
          desensitizeBuiltinRuleOverrides: { email: false },
        },
      }),
      'utf-8'
    )

    const config = loadCliPreprocessConfig(tempDir, 'zh-CN')
    const emailRule = config.desensitizeRules.find((r) => r.id === 'email')
    assert.equal(emailRule?.enabled, false)

    const result = preprocessMessages([msg('联系 test@example.com 谢谢')], config)
    assert.ok(result[0].content?.includes('test@example.com'))
  })

  it('carries user blacklist keywords into the config', () => {
    writeFileSync(
      join(tempDir, 'preferences.json'),
      JSON.stringify({
        aiPreprocessConfig: {
          blacklistKeywords: ['机密'],
        },
      }),
      'utf-8'
    )

    const config = loadCliPreprocessConfig(tempDir, 'zh-CN')
    assert.deepEqual(config.blacklistKeywords, ['机密'])

    const result = preprocessMessages([msg('这是机密文件不要外传'), msg('普通消息说点别的')], config)
    assert.equal(result.length, 1)
    assert.ok(result[0].content?.includes('普通消息'))
  })
})
