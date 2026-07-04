import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { after, beforeEach, describe, it } from 'node:test'

const tempHome = mkdtempSync(join(tmpdir(), 'chatlab-config-set-'))
process.env.HOME = tempHome

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
