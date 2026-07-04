/**
 * Safe config field writer for `chatlab config set`.
 *
 * Wraps writeConfigField with guardrails: only schema-defined keys are accepted,
 * values are parsed by schema type, and the file is validated after writing with
 * rollback on failure — a broken config file is a user-data incident.
 */

import * as fs from 'fs'
import * as path from 'path'
import { parse as parseToml } from 'smol-toml'
import { configSchema } from './schema'
import { writeConfigField, getConfigDir } from './loader'

export type ConfigSetErrorReason = 'unknown_key' | 'invalid_value' | 'invalid_config' | 'unreadable_config'

export class ConfigSetError extends Error {
  readonly reason: ConfigSetErrorReason

  constructor(reason: ConfigSetErrorReason, message: string) {
    super(message)
    this.name = 'ConfigSetError'
    this.reason = reason
  }
}

export interface ConfigSetResult {
  section: string
  key: string
  value: string | number | boolean
}

/**
 * Set a config field addressed as `<section>.<key>` (e.g. `cli.allow_raw`).
 * Throws ConfigSetError without touching the file when the key or value is invalid;
 * rolls the file back when the written config fails full validation.
 */
export function setConfigField(fieldPath: string, rawValue: string): ConfigSetResult {
  const parts = fieldPath.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new ConfigSetError('unknown_key', `Expected <section>.<key>, got "${fieldPath}"`)
  }
  const [section, key] = parts

  const defaults = configSchema.parse({}) as Record<string, Record<string, unknown>>
  const sectionDefaults = defaults[section]
  if (!sectionDefaults || typeof sectionDefaults !== 'object') {
    throw new ConfigSetError('unknown_key', `Unknown config section "${section}"`)
  }
  if (!(key in sectionDefaults)) {
    throw new ConfigSetError('unknown_key', `Unknown config key "${section}.${key}"`)
  }

  const value = parseValueByType(section, key, typeof sectionDefaults[key], rawValue)

  const tomlPath = path.join(getConfigDir(), 'config.toml')
  let original: string | null = null
  if (fs.existsSync(tomlPath)) {
    original = fs.readFileSync(tomlPath, 'utf-8')
    try {
      parseToml(original)
    } catch {
      throw new ConfigSetError(
        'unreadable_config',
        `Existing config file is not valid TOML and will not be overwritten: ${tomlPath}`
      )
    }
  }

  writeConfigField(section, key, value)

  try {
    validateConfigFile(tomlPath)
  } catch (err) {
    if (original === null) {
      fs.unlinkSync(tomlPath)
    } else {
      fs.writeFileSync(tomlPath, original, 'utf-8')
    }
    const detail = err instanceof Error ? err.message : String(err)
    throw new ConfigSetError(
      'invalid_config',
      `Value "${rawValue}" for ${section}.${key} failed config validation; file rolled back. ${detail}`
    )
  }

  return { section, key, value }
}

function validateConfigFile(tomlPath: string): void {
  const written = fs.readFileSync(tomlPath, 'utf-8')
  const parsed = parseToml(written) as Record<string, unknown>
  configSchema.parse(parsed)
}

function parseValueByType(
  section: string,
  key: string,
  expectedType: string,
  rawValue: string
): string | number | boolean {
  if (expectedType === 'boolean') {
    if (rawValue === 'true') return true
    if (rawValue === 'false') return false
    throw new ConfigSetError('invalid_value', `${section}.${key} expects "true" or "false", got "${rawValue}"`)
  }
  if (expectedType === 'number') {
    const num = Number(rawValue)
    if (!Number.isFinite(num) || rawValue.trim() === '') {
      throw new ConfigSetError('invalid_value', `${section}.${key} expects a number, got "${rawValue}"`)
    }
    return num
  }
  return rawValue
}
