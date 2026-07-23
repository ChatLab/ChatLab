/**
 * Migration v0→v1: Legacy 单配置 → 多配置格式
 *
 * 旧格式：{ provider, apiKey, model, ... }（扁平对象）
 * 新格式：{ configs: [{ id, name, provider, apiKey, model, ... }], defaultAssistant, fastModel }
 */

import * as path from 'path'
import { randomUUID } from 'crypto'
import { readJsonFile, withFileLock, writeJsonFileAtomically } from '../atomic-json-file'
import type { Migration, MigrationContext } from './types'

interface LegacyFlatConfig {
  provider: string
  apiKey: string
  model?: string
  maxTokens?: number
  [key: string]: unknown
}

function isLegacyFlatConfig(data: unknown): data is LegacyFlatConfig {
  if (!data || typeof data !== 'object') return false
  const obj = data as Record<string, unknown>
  return 'provider' in obj && 'apiKey' in obj && !('configs' in obj)
}

export const m001LegacyToMultiConfig: Migration = {
  version: 1,
  name: 'legacy-to-multi-config',
  description: 'Convert legacy flat LLM config to multi-config format',

  async up(ctx: MigrationContext) {
    const configPath = path.join(ctx.aiDataDir, 'llm-config.json')
    withFileLock(configPath, () => {
      const data = readJsonFile<unknown>(configPath)
      if (!isLegacyFlatConfig(data)) return

      ctx.logger.info('Migration', 'Converting legacy flat config to multi-config format')

      const now = Date.now()
      const newConfig = {
        id: randomUUID(),
        name: data.provider,
        provider: data.provider,
        apiKey: data.apiKey || '',
        model: data.model || '',
        maxTokens: data.maxTokens,
        createdAt: now,
        updatedAt: now,
      }

      const migrated = {
        schemaVersion: 1,
        configs: [newConfig],
        defaultAssistant: { configId: newConfig.id, modelId: newConfig.model },
        fastModel: null,
      }

      writeJsonFileAtomically(configPath, migrated)
      ctx.logger.info('Migration', 'Legacy config migrated to multi-config format')
    })
  },
}
