/**
 * 配置加载器
 *
 * 优先级（从高到低）：
 * 1. CHATLAB_* 环境变量
 * 2. ~/.chatlab/config.toml（或 config.json）
 * 3. Zod schema 默认值
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { parse as parseToml } from 'smol-toml'
import { configSchema, type ChatLabConfig } from './schema'

const CONFIG_DIR = path.join(os.homedir(), '.chatlab')
const CONFIG_TOML = path.join(CONFIG_DIR, 'config.toml')
const CONFIG_JSON = path.join(CONFIG_DIR, 'config.json')

/**
 * 加载完整配置
 */
export function loadConfig(overrides?: Partial<ChatLabConfig>): ChatLabConfig {
  const fileConfig = loadConfigFile()
  const envConfig = loadEnvConfig()

  const merged = deepMerge(deepMerge(fileConfig, envConfig), overrides ?? {})
  return configSchema.parse(merged)
}

/**
 * 获取配置文件路径（返回实际存在的路径或默认 TOML 路径）
 */
export function getConfigPath(): string {
  if (fs.existsSync(CONFIG_TOML)) return CONFIG_TOML
  if (fs.existsSync(CONFIG_JSON)) return CONFIG_JSON
  return CONFIG_TOML
}

/**
 * 获取配置目录路径
 */
export function getConfigDir(): string {
  return CONFIG_DIR
}

/**
 * 从文件加载配置
 */
function loadConfigFile(): Record<string, unknown> {
  if (fs.existsSync(CONFIG_TOML)) {
    try {
      const content = fs.readFileSync(CONFIG_TOML, 'utf-8')
      return parseToml(content) as Record<string, unknown>
    } catch (err) {
      console.warn(`[Config] Failed to parse ${CONFIG_TOML}:`, err)
    }
  }

  if (fs.existsSync(CONFIG_JSON)) {
    try {
      const content = fs.readFileSync(CONFIG_JSON, 'utf-8')
      return JSON.parse(content) as Record<string, unknown>
    } catch (err) {
      console.warn(`[Config] Failed to parse ${CONFIG_JSON}:`, err)
    }
  }

  return {}
}

/**
 * 从 CHATLAB_* 环境变量加载配置
 *
 * 映射规则：
 * - CHATLAB_DATA_DIR       -> data.user_data_dir
 * - CHATLAB_API_PORT       -> api.port
 * - CHATLAB_API_HOST       -> api.host
 * - CHATLAB_LLM_PROVIDER   -> llm.provider
 * - CHATLAB_LLM_MODEL      -> llm.model
 * - CHATLAB_LLM_BASE_URL   -> llm.base_url
 * - CHATLAB_LOCALE_LANG    -> locale.lang
 */
function loadEnvConfig(): Record<string, unknown> {
  const result: Record<string, Record<string, unknown>> = {}

  const envMap: Array<{ env: string; section: string; key: string; transform?: (v: string) => unknown }> = [
    { env: 'CHATLAB_DATA_DIR', section: 'data', key: 'user_data_dir' },
    { env: 'CHATLAB_API_PORT', section: 'api', key: 'port', transform: (v) => parseInt(v, 10) },
    { env: 'CHATLAB_API_HOST', section: 'api', key: 'host' },
    { env: 'CHATLAB_LLM_PROVIDER', section: 'llm', key: 'provider' },
    { env: 'CHATLAB_LLM_MODEL', section: 'llm', key: 'model' },
    { env: 'CHATLAB_LLM_BASE_URL', section: 'llm', key: 'base_url' },
    { env: 'CHATLAB_LOCALE_LANG', section: 'locale', key: 'lang' },
  ]

  for (const { env, section, key, transform } of envMap) {
    const value = process.env[env]
    if (value !== undefined && value !== '') {
      if (!result[section]) result[section] = {}
      result[section][key] = transform ? transform(value) : value
    }
  }

  return result
}

/**
 * 写入 config.toml 的某个字段
 *
 * 如果文件不存在则创建，如果已存在则保留其他内容，只更新指定字段。
 * 采用简单的 TOML 序列化：仅支持一级 section + 字符串/数字值。
 */
export function writeConfigField(section: string, key: string, value: string | number | boolean): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
  }

  let existing: Record<string, Record<string, unknown>> = {}
  if (fs.existsSync(CONFIG_TOML)) {
    try {
      const content = fs.readFileSync(CONFIG_TOML, 'utf-8')
      existing = parseToml(content) as Record<string, Record<string, unknown>>
    } catch {
      // 解析失败时从空开始，旧文件会被覆盖
    }
  }

  if (!existing[section] || typeof existing[section] !== 'object') {
    existing[section] = {}
  }
  existing[section][key] = value

  const lines: string[] = []
  for (const [sec, entries] of Object.entries(existing)) {
    if (typeof entries !== 'object' || entries === null) continue
    lines.push(`[${sec}]`)
    for (const [k, v] of Object.entries(entries as Record<string, unknown>)) {
      if (typeof v === 'string') {
        lines.push(`${k} = ${JSON.stringify(v)}`)
      } else if (typeof v === 'number' || typeof v === 'boolean') {
        lines.push(`${k} = ${v}`)
      }
    }
    lines.push('')
  }

  fs.writeFileSync(CONFIG_TOML, lines.join('\n'), 'utf-8')
}

/**
 * 简单的深度合并（仅处理纯对象，不处理数组）
 */
function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base }
  for (const [key, value] of Object.entries(override)) {
    if (value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = deepMerge((result[key] as Record<string, unknown>) ?? {}, value as Record<string, unknown>)
    } else if (value !== undefined) {
      result[key] = value
    }
  }
  return result
}
