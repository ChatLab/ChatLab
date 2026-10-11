import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { after, beforeEach, describe, it } from 'node:test'
import { parse as parseToml } from 'smol-toml'
import { z } from 'zod'

const tempHome = mkdtempSync(join(tmpdir(), 'chatlab-config-set-'))
process.env.HOME = tempHome
process.env.USERPROFILE = tempHome

const [{ setConfigField, ConfigSetError }, { loadConfig }] = await Promise.all([
  import('./set-config-field'),
  import('./loader'),
])

const configToml = join(tempHome, '.chatlab', 'config.toml')
const configJson = join(tempHome, '.chatlab', 'config.json')

beforeEach(() => {
  rmSync(join(tempHome, '.chatlab'), { recursive: true, force: true })
  delete process.env.CHATLAB_CLI_ALLOW_RAW
  delete process.env.CHATLAB_API_PORT
})

after(() => {
  rmSync(tempHome, { recursive: true, force: true })
})

describe('cli config section', () => {
  it('defaults allow_raw=false and allow_sql=true', () => {
    const config = loadConfig()
    assert.equal(config.cli.allow_raw, false)
    assert.equal(config.cli.allow_sql, true)
  })

  it('maps CHATLAB_CLI_ALLOW_RAW env var to cli.allow_raw', () => {
    process.env.CHATLAB_CLI_ALLOW_RAW = '1'
    assert.equal(loadConfig().cli.allow_raw, true)

    process.env.CHATLAB_CLI_ALLOW_RAW = 'true'
    assert.equal(loadConfig().cli.allow_raw, true)

    process.env.CHATLAB_CLI_ALLOW_RAW = '0'
    assert.equal(loadConfig().cli.allow_raw, false)
  })
})

describe('setConfigField', () => {
  it('defaults old desktop configs to 100% and persists UI scale without changing other preferences', () => {
    mkdirSync(join(tempHome, '.chatlab'), { recursive: true })
    writeFileSync(configToml, '[desktop]\nclose_behavior = "quit"\n[locale]\nlang = "en-US"\n', 'utf-8')

    assert.equal(loadConfig().desktop.ui_scale, 1)
    setConfigField('desktop.ui_scale', '1.25')

    const config = loadConfig()
    assert.equal(config.desktop.ui_scale, 1.25)
    assert.equal(config.desktop.close_behavior, 'quit')
    assert.equal(config.locale.lang, 'en-US')

    const saved = readFileSync(configToml, 'utf-8')
    assert.throws(() => setConfigField('desktop.ui_scale', '0'))
    assert.equal(readFileSync(configToml, 'utf-8'), saved)
  })

  it('persists the Windows close behavior', () => {
    const result = setConfigField('desktop.close_behavior', 'background')

    assert.deepEqual(result, { section: 'desktop', key: 'close_behavior', value: 'background' })
    assert.equal(loadConfig().desktop.close_behavior, 'background')
  })

  it('persists memory without breaking the v0.37.5 UI config schema', () => {
    setConfigField('ui.default_session_tab', 'memory')

    assert.equal(loadConfig().ui.default_session_tab, 'memory')

    const saved = parseToml(readFileSync(configToml, 'utf-8')) as { ui: Record<string, unknown> }
    const releasedUiConfigSchema = z.object({
      default_session_tab: z.preprocess(
        (value) => (value === 'overview' ? 'insights' : value),
        z.enum(['insights', 'ai-chat']).default('insights')
      ),
      session_gap_threshold: z.number().int().min(60).max(86400).default(1800),
      summary_strategy: z.enum(['brief', 'standard']).default('standard'),
    })
    assert.equal(releasedUiConfigSchema.parse(saved.ui).default_session_tab, 'insights')
  })

  it('honors a later session tab write from a v0.37.5 client', () => {
    setConfigField('ui.default_session_tab', 'memory')

    let content = readFileSync(configToml, 'utf-8').replace(
      'default_session_tab = "overview"',
      'default_session_tab = "ai-chat"'
    )
    writeFileSync(configToml, content, 'utf-8')
    assert.equal(loadConfig().ui.default_session_tab, 'ai-chat')

    content = content.replace('default_session_tab = "ai-chat"', 'default_session_tab = "insights"')
    writeFileSync(configToml, content, 'utf-8')
    assert.equal(loadConfig().ui.default_session_tab, 'insights')
  })

  it('writes boolean value and round-trips via loadConfig', () => {
    const result = setConfigField('cli.allow_raw', 'true')
    assert.deepEqual(result, { section: 'cli', key: 'allow_raw', value: true })
    assert.equal(loadConfig().cli.allow_raw, true)

    setConfigField('cli.allow_raw', 'false')
    assert.equal(loadConfig().cli.allow_raw, false)
  })

  it('parses number values by schema type', () => {
    setConfigField('api.port', '8080')
    assert.equal(loadConfig().api.port, 8080)
  })

  it('validates written file values without environment overrides', () => {
    process.env.CHATLAB_API_PORT = '3110'

    assert.throws(
      () => setConfigField('api.port', '70000'),
      (err: unknown) => {
        assert.ok(err instanceof ConfigSetError)
        assert.equal(err.reason, 'invalid_config')
        return true
      }
    )
    assert.equal(existsSync(configToml), false)
  })

  it('preserves legacy JSON config when creating TOML', () => {
    mkdirSync(join(tempHome, '.chatlab'), { recursive: true })
    writeFileSync(
      configJson,
      JSON.stringify({
        data: { user_data_dir: '/tmp/chatlab-legacy-data' },
        api: { host: '0.0.0.0' },
      }),
      'utf-8'
    )

    setConfigField('cli.allow_raw', 'true')

    const config = loadConfig()
    assert.equal(config.cli.allow_raw, true)
    assert.equal(config.data.user_data_dir, '/tmp/chatlab-legacy-data')
    assert.equal(config.api.host, '0.0.0.0')
  })

  it('rejects unknown section or key without touching the file', () => {
    assert.throws(
      () => setConfigField('nope.key', 'x'),
      (err: unknown) => {
        assert.ok(err instanceof ConfigSetError)
        assert.equal(err.reason, 'unknown_key')
        return true
      }
    )
    assert.throws(
      () => setConfigField('cli.nope', 'x'),
      (err: unknown) => {
        assert.ok(err instanceof ConfigSetError)
        assert.equal(err.reason, 'unknown_key')
        return true
      }
    )
    assert.throws(
      () => setConfigField('cli', 'x'),
      (err: unknown) => {
        assert.ok(err instanceof ConfigSetError)
        assert.equal(err.reason, 'unknown_key')
        return true
      }
    )
    assert.equal(existsSync(configToml), false)
  })

  it('rejects values that do not parse as the schema type', () => {
    assert.throws(
      () => setConfigField('cli.allow_raw', 'yes'),
      (err: unknown) => {
        assert.ok(err instanceof ConfigSetError)
        assert.equal(err.reason, 'invalid_value')
        return true
      }
    )
    assert.throws(
      () => setConfigField('api.port', 'not-a-number'),
      (err: unknown) => {
        assert.ok(err instanceof ConfigSetError)
        assert.equal(err.reason, 'invalid_value')
        return true
      }
    )
    assert.equal(existsSync(configToml), false)
  })

  it('rolls back when post-write validation fails', () => {
    setConfigField('cli.allow_raw', 'true')
    const original = readFileSync(configToml, 'utf-8')

    // typeof default is string, passes type parsing, but violates the zod enum on reload
    assert.throws(
      () => setConfigField('ui.default_session_tab', 'bogus'),
      (err: unknown) => {
        assert.ok(err instanceof ConfigSetError)
        assert.equal(err.reason, 'invalid_config')
        return true
      }
    )

    assert.equal(readFileSync(configToml, 'utf-8'), original)
    assert.equal(loadConfig().cli.allow_raw, true)
  })

  it('removes the file on rollback when it did not exist before', () => {
    assert.throws(
      () => setConfigField('ui.default_session_tab', 'bogus'),
      (err: unknown) => {
        assert.ok(err instanceof ConfigSetError)
        assert.equal(err.reason, 'invalid_config')
        return true
      }
    )
    assert.equal(existsSync(configToml), false)
  })

  it('refuses to overwrite an unparseable config file', () => {
    mkdirSync(join(tempHome, '.chatlab'), { recursive: true })
    const corrupt = '[cli\nallow_raw ='
    writeFileSync(configToml, corrupt, 'utf-8')

    assert.throws(
      () => setConfigField('cli.allow_raw', 'true'),
      (err: unknown) => {
        assert.ok(err instanceof ConfigSetError)
        assert.equal(err.reason, 'unreadable_config')
        return true
      }
    )
    assert.equal(readFileSync(configToml, 'utf-8'), corrupt)
  })
})
