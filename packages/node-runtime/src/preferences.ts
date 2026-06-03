/**
 * PreferencesManager — manages ~/.chatlab/preferences.json
 *
 * Stores complex user preferences that cannot fit into config.toml
 * (arrays, nested objects) and need cross-client consistency.
 */

import * as fs from 'fs'
import * as path from 'path'
import type {
  Preferences,
  AIGlobalSettings,
  AIPreprocessConfig,
  WordFilterScheme,
  KeywordTemplate,
  ContextCompressionSettings,
  DesensitizeRule,
  FilterHistoryItem,
} from '@openchatlab/shared-types'

export type {
  Preferences,
  AIGlobalSettings,
  AIPreprocessConfig,
  WordFilterScheme,
  KeywordTemplate,
  ContextCompressionSettings,
  DesensitizeRule,
  FilterHistoryItem,
}

const DEFAULTS: Preferences = {
  pinnedSessionIds: [],
  aiPreprocessConfig: {
    dataCleaning: true,
    mergeConsecutive: true,
    mergeWindowSeconds: 180,
    blacklistKeywords: [],
    denoise: true,
    desensitize: true,
    desensitizeRules: [],
    anonymizeNames: false,
  },
  aiGlobalSettings: {
    maxMessagesPerRequest: 1000,
    exportFormat: 'markdown',
    sqlExportFormat: 'csv',
    enableAutoSkill: true,
    searchContextBefore: 2,
    searchContextAfter: 2,
    contextCompression: {
      enabled: true,
      tokenThresholdPercent: 75,
      bufferSizePercent: 20,
      maxToolResultPercent: 50,
    },
  },
  customKeywordTemplates: [],
  deletedPresetTemplateIds: [],
  wordFilter: {
    schemes: [],
    defaultSchemeId: null,
    sessionSchemeOverrides: {},
  },
  filterHistory: [],
}

export class PreferencesManager {
  private filePath: string
  private cache: Preferences | null = null

  constructor(systemDir: string) {
    this.filePath = path.join(systemDir, 'preferences.json')
  }

  load(): Preferences {
    if (this.cache) return this.cache

    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8')
        const parsed = JSON.parse(raw) as Partial<Preferences>
        this.cache = this.mergeDefaults(parsed)
        return this.cache
      }
    } catch (err) {
      console.warn('[Preferences] Failed to load preferences.json:', err)
    }

    this.cache = { ...DEFAULTS }
    return this.cache
  }

  save(partial: Partial<Preferences>): { success: boolean; error?: string } {
    try {
      const current = this.load()
      const merged = this.deepMerge(
        current as unknown as Record<string, unknown>,
        partial as unknown as Record<string, unknown>
      )
      this.cache = merged as unknown as Preferences

      const dir = path.dirname(this.filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2), 'utf-8')
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[Preferences] Failed to save:', msg)
      return { success: false, error: msg }
    }
  }

  getFilePath(): string {
    return this.filePath
  }

  invalidateCache(): void {
    this.cache = null
  }

  private mergeDefaults(partial: Partial<Preferences>): Preferences {
    return {
      pinnedSessionIds: partial.pinnedSessionIds ?? DEFAULTS.pinnedSessionIds,
      aiPreprocessConfig: partial.aiPreprocessConfig
        ? { ...DEFAULTS.aiPreprocessConfig, ...partial.aiPreprocessConfig }
        : { ...DEFAULTS.aiPreprocessConfig },
      aiGlobalSettings: partial.aiGlobalSettings
        ? {
            ...DEFAULTS.aiGlobalSettings,
            ...partial.aiGlobalSettings,
            contextCompression: {
              ...DEFAULTS.aiGlobalSettings.contextCompression,
              ...(partial.aiGlobalSettings.contextCompression ?? {}),
            },
          }
        : { ...DEFAULTS.aiGlobalSettings },
      customKeywordTemplates: partial.customKeywordTemplates ?? DEFAULTS.customKeywordTemplates,
      deletedPresetTemplateIds: partial.deletedPresetTemplateIds ?? DEFAULTS.deletedPresetTemplateIds,
      wordFilter: partial.wordFilter ? { ...DEFAULTS.wordFilter, ...partial.wordFilter } : { ...DEFAULTS.wordFilter },
      filterHistory: partial.filterHistory ?? DEFAULTS.filterHistory,
    }
  }

  /**
   * Deep merge: arrays are replaced (not concatenated), objects are merged.
   */
  private deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
    const result = { ...base }
    for (const [key, value] of Object.entries(override)) {
      if (value === undefined) continue
      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        typeof base[key] === 'object' &&
        base[key] !== null &&
        !Array.isArray(base[key])
      ) {
        result[key] = this.deepMerge(base[key] as Record<string, unknown>, value as Record<string, unknown>)
      } else {
        result[key] = value
      }
    }
    return result
  }
}
