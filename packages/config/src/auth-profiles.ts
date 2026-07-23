/**
 * auth-profiles.json 凭证管理
 *
 * 存储位置：~/.chatlab/auth-profiles.json
 * 用途：将 API Key 等敏感凭证与主配置文件分离
 */

import * as path from 'path'
import { getConfigDir } from './loader'
import { readJsonFile, withFileLock, writeJsonFileAtomically } from './atomic-json-file'

export interface AuthProfile {
  type: 'api_key'
  provider: string
  key: string
}

export interface AuthProfilesData {
  version: number
  profiles: Record<string, AuthProfile>
}

const AUTH_PROFILES_FILE = 'auth-profiles.json'

export function deriveAuthProfileName(provider: string, config: { baseUrl?: unknown; name?: unknown }): string {
  if (provider !== 'openai-compatible') {
    return provider.toLowerCase().replace(/\s+/g, '-')
  }

  if (typeof config.baseUrl === 'string' && config.baseUrl) {
    try {
      return new URL(config.baseUrl).hostname.toLowerCase()
    } catch {
      // Invalid URLs fall back to the config name.
    }
  }

  if (typeof config.name === 'string' && config.name) {
    return config.name.toLowerCase().replace(/\s+/g, '-')
  }

  return 'custom'
}

function getAuthProfilesPath(): string {
  return path.join(getConfigDir(), AUTH_PROFILES_FILE)
}

/**
 * 加载 auth-profiles.json
 */
export function loadAuthProfiles(): AuthProfilesData {
  const data = readJsonFile<AuthProfilesData>(getAuthProfilesPath())
  if (!data?.profiles || typeof data.profiles !== 'object') {
    return { version: 1, profiles: {} }
  }
  return data
}

/**
 * 按 profile 名称获取 API Key
 */
export function getApiKeyByProfile(profileName: string): string {
  const data = loadAuthProfiles()
  const profile = data.profiles[profileName]
  return profile?.key || ''
}

/**
 * 按 provider 名称获取 API Key（模糊匹配，取第一个匹配的 profile）
 */
export function getApiKeyByProvider(provider: string): string {
  const data = loadAuthProfiles()
  for (const profile of Object.values(data.profiles)) {
    if (profile.provider === provider) {
      return profile.key || ''
    }
  }
  return ''
}

/**
 * 查找 API Key：先按 authProfile 精确匹配，再按 provider 兜底
 */
export function resolveApiKey(provider: string, authProfile?: string): string {
  if (authProfile) {
    const key = getApiKeyByProfile(authProfile)
    if (key) return key
  }
  return getApiKeyByProvider(provider)
}

/**
 * 写入/更新一个 auth profile
 */
export function writeAuthProfile(name: string, profile: AuthProfile): void {
  const filePath = getAuthProfilesPath()
  withFileLock(filePath, () => {
    const data = loadAuthProfiles()
    data.profiles[name] = profile
    writeJsonFileAtomically(filePath, data, 0o600)
  })
}

/**
 * 删除一个 auth profile
 */
export function deleteAuthProfile(name: string): boolean {
  const filePath = getAuthProfilesPath()
  return withFileLock(filePath, () => {
    const data = loadAuthProfiles()
    if (!(name in data.profiles)) return false

    delete data.profiles[name]
    writeJsonFileAtomically(filePath, data, 0o600)
    return true
  })
}
