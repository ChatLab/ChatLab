/**
 * Migration v1→v2: Schema v2 升级
 *
 * - 移除 configs 中的 disableThinking / isReasoningModel 字段
 * - 更新 schemaVersion 为 2
 *
 * Legacy custom model registration depends on the shared runtime catalog.
 * createLlmRuntimeStores handles that step after loading the migrated store.
 */

import * as path from 'path'
import { readJsonFile, withFileLock, writeJsonFileAtomically } from '../atomic-json-file'
import type { Migration, MigrationContext } from './types'

export const m002SchemaV2: Migration = {
  version: 2,
  name: 'schema-v2',
  description: 'Upgrade LLM config to schema v2 (remove deprecated fields)',

  async up(ctx: MigrationContext) {
    const configPath = path.join(ctx.aiDataDir, 'llm-config.json')
    withFileLock(configPath, () => {
      const data = readJsonFile<Record<string, unknown>>(configPath)
      if (!data) return

      const schemaVersion = (data.schemaVersion as number) || 0
      if (schemaVersion >= 2) return

      ctx.logger.info('Migration', 'Upgrading LLM config to schema v2')

      const configs = (data.configs as Record<string, unknown>[]) || []
      const cleanedConfigs = configs.map((c) => {
        const { disableThinking: _dt, isReasoningModel: _rm, ...rest } = c
        return rest
      })

      data.configs = cleanedConfigs
      data.schemaVersion = 2

      writeJsonFileAtomically(configPath, data)
    })
  },
}
