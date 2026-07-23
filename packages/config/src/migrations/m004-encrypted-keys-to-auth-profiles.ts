/**
 * Migration v3→v4: 加密 API Key → auth-profiles.json
 *
 * - 从 llm-config.json 读取加密的 apiKey（enc: 前缀）
 * - 使用 device-key + legacy machine-id 尝试解密
 * - 解密成功的写入 auth-profiles.json
 * - 清空 llm-config.json 中的 apiKey 字段
 */

import * as path from 'path'
import type { Migration, MigrationContext } from './types'
import { isEncrypted, decryptApiKey } from './crypto-legacy'
import { deriveAuthProfileName, writeAuthProfile } from '../auth-profiles'
import { readJsonFile, withFileLock, writeJsonFileAtomically } from '../atomic-json-file'

export const m004EncryptedKeysToAuthProfiles: Migration = {
  version: 4,
  name: 'encrypted-keys-to-auth-profiles',
  description: 'Migrate encrypted API keys from llm-config.json to auth-profiles.json',

  async up(ctx: MigrationContext) {
    const configPath = path.join(ctx.aiDataDir, 'llm-config.json')
    withFileLock(configPath, () => {
      const data = readJsonFile<Record<string, unknown>>(configPath)
      if (!data) return

      const configs = (data.configs as Array<Record<string, unknown>>) || []
      let migrated = false
      const usedProfileNames = new Set<string>()

      for (const config of configs) {
        const apiKey = config.apiKey as string
        if (!apiKey) continue

        const provider = (config.provider as string) || 'unknown'
        let plainKey: string | null = null

        if (isEncrypted(apiKey)) {
          plainKey = decryptApiKey(apiKey)
          if (!plainKey) {
            ctx.logger.warn('Migration', `Failed to decrypt API key for "${config.name}", skipping`)
            continue
          }
        } else if (apiKey.length > 0) {
          plainKey = apiKey
        }

        if (plainKey) {
          const baseName = deriveAuthProfileName(provider, config)

          let profileName = baseName
          if (usedProfileNames.has(profileName)) {
            let i = 2
            while (usedProfileNames.has(`${profileName}-${i}`)) i++
            profileName = `${profileName}-${i}`
          }
          usedProfileNames.add(profileName)

          writeAuthProfile(profileName, { type: 'api_key', provider, key: plainKey })
          config.authProfile = profileName
          config.apiKey = ''
          migrated = true
          ctx.logger.info('Migration', `Migrated API key → profile "${profileName}"`)
        }
      }

      if (migrated) {
        writeJsonFileAtomically(configPath, data)
        ctx.logger.info('Migration', 'Cleared API keys from llm-config.json')
      }
    })
  },
}
