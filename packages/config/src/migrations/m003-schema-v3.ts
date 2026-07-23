/**
 * Migration v2→v3: Schema v3 升级 — 双 slot 模型选择
 *
 * - 将 activeConfigId → defaultAssistant { configId, modelId }
 * - 新增 fastModel slot（默认 null）
 * - 更新 schemaVersion 为 3
 */

import * as path from 'path'
import { readJsonFile, withFileLock, writeJsonFileAtomically } from '../atomic-json-file'
import type { Migration, MigrationContext } from './types'

export const m003SchemaV3: Migration = {
  version: 3,
  name: 'schema-v3-dual-slot',
  description: 'Upgrade LLM config to schema v3 (dual-slot model selection)',

  async up(ctx: MigrationContext) {
    const configPath = path.join(ctx.aiDataDir, 'llm-config.json')
    withFileLock(configPath, () => {
      const data = readJsonFile<Record<string, unknown>>(configPath)
      if (!data) return

      const schemaVersion = (data.schemaVersion as number) || 0
      if (schemaVersion >= 3) return

      ctx.logger.info('Migration', 'Upgrading LLM config to schema v3 (dual-slot)')

      const configs = (data.configs as Array<{ id: string; model?: string }>) || []
      const activeConfigId = data.activeConfigId as string | null | undefined

      const resolvedConfig =
        activeConfigId && configs.find((c) => c.id === activeConfigId)
          ? configs.find((c) => c.id === activeConfigId)!
          : (configs[0] ?? null)

      data.defaultAssistant = resolvedConfig
        ? { configId: resolvedConfig.id, modelId: resolvedConfig.model || '' }
        : null
      data.fastModel = data.fastModel ?? null
      data.schemaVersion = 3
      delete data.activeConfigId

      writeJsonFileAtomically(configPath, data)
    })
  },
}
