/**
 * PreferencesManager — manages ~/.chatlab/preferences.json
 *
 * Stores complex user preferences that cannot fit into config.toml
 * (arrays, nested objects) and need cross-client consistency.
 */

import * as fs from 'fs'
import * as path from 'path'
import { DESENSITIZE_RULES_SCHEMA_VERSION } from './ai/preprocessor'
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
    desensitizeRulesSchemaVersion: DESENSITIZE_RULES_SCHEMA_VERSION,
    desensitizeBuiltinRuleOverrides: {},
    desensitizeRules: [],
    anonymizeNames: false,
  },
  aiGlobalSettings: {
    maxMessagesPerRequest: 1000,
    exportFormat: 'markdown',
    sqlExportFormat: 'csv',
    enableAutoSkill: true,
    chartAutoMode: 'suggest',
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
  thinkingLevels: {},
  ownerProfilesByPlatform: {},
  ownerPromptDismissedSessionIds: [],
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
        const migrated = this.migrateLegacyDesensitizeRules(parsed, raw)
        this.cache = this.mergeDefaults(migrated.preferences)
        if (migrated.changed) {
          this.writePreferences(this.cache)
        }
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
      if (Object.prototype.hasOwnProperty.call(partial.aiPreprocessConfig ?? {}, 'desensitizeBuiltinRuleOverrides')) {
        const mergedAiPreprocessConfig = merged.aiPreprocessConfig as Record<string, unknown>
        mergedAiPreprocessConfig.desensitizeBuiltinRuleOverrides =
          partial.aiPreprocessConfig?.desensitizeBuiltinRuleOverrides
      }
      this.cache = this.mergeDefaults(merged as unknown as Partial<Preferences>)

      this.writePreferences(this.cache)
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
        ? this.normalizeAiPreprocessConfig(partial.aiPreprocessConfig)
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
      thinkingLevels: partial.thinkingLevels ?? DEFAULTS.thinkingLevels,
      ownerProfilesByPlatform: partial.ownerProfilesByPlatform ?? DEFAULTS.ownerProfilesByPlatform,
      ownerPromptDismissedSessionIds: partial.ownerPromptDismissedSessionIds ?? DEFAULTS.ownerPromptDismissedSessionIds,
    }
  }

  private normalizeAiPreprocessConfig(partial: Partial<AIPreprocessConfig> | undefined): AIPreprocessConfig {
    const defaults = DEFAULTS.aiPreprocessConfig
    const rules = Array.isArray(partial?.desensitizeRules) ? partial.desensitizeRules : []
    const customRules = rules.filter((rule) => !rule.builtin)
    return {
      dataCleaning: partial?.dataCleaning ?? defaults.dataCleaning,
      mergeConsecutive: partial?.mergeConsecutive ?? defaults.mergeConsecutive,
      mergeWindowSeconds: partial?.mergeWindowSeconds ?? defaults.mergeWindowSeconds,
      blacklistKeywords: partial?.blacklistKeywords ?? defaults.blacklistKeywords,
      denoise: partial?.denoise ?? defaults.denoise,
      desensitize: partial?.desensitize ?? defaults.desensitize,
      desensitizeRulesSchemaVersion: DESENSITIZE_RULES_SCHEMA_VERSION,
      desensitizeBuiltinRuleOverrides: this.normalizeBooleanMap(partial?.desensitizeBuiltinRuleOverrides),
      desensitizeRules: customRules,
      anonymizeNames: partial?.anonymizeNames ?? defaults.anonymizeNames,
    }
  }

  private normalizeBooleanMap(value: unknown): Record<string, boolean> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const result: Record<string, boolean> = {}
    for (const [key, flag] of Object.entries(value as Record<string, unknown>)) {
      if (typeof flag === 'boolean') result[key] = flag
    }
    return result
  }

  private migrateLegacyDesensitizeRules(
    partial: Partial<Preferences>,
    rawContent: string
  ): { preferences: Partial<Preferences>; changed: boolean } {
    const rules = partial.aiPreprocessConfig?.desensitizeRules
    if (!Array.isArray(rules) || !rules.some((rule) => rule.builtin)) {
      return { preferences: partial, changed: false }
    }

    this.backupLegacyPreferences(rawContent)

    const legacyBuiltinRuleOverrides = rules
      .filter((rule) => rule.builtin && typeof rule.enabled === 'boolean')
      .reduce<Record<string, boolean>>((overrides, rule) => {
        overrides[rule.id] = rule.enabled
        return overrides
      }, {})
    const existingOverrides = this.normalizeBooleanMap(partial.aiPreprocessConfig?.desensitizeBuiltinRuleOverrides)

    return {
      preferences: {
        ...partial,
        aiPreprocessConfig: {
          ...partial.aiPreprocessConfig,
          desensitizeRulesSchemaVersion: DESENSITIZE_RULES_SCHEMA_VERSION,
          desensitizeBuiltinRuleOverrides: {
            ...legacyBuiltinRuleOverrides,
            ...existingOverrides,
          },
          desensitizeRules: rules.filter((rule) => !rule.builtin),
        },
      } as Partial<Preferences>,
      changed: true,
    }
  }

  private backupLegacyPreferences(rawContent: string): void {
    const backupDir = path.join(path.dirname(this.filePath), 'backups')
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true })
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = path.join(backupDir, `preferences-pre-desensitize-groups-${timestamp}.json`)
    fs.writeFileSync(backupPath, rawContent, 'utf-8')
    console.info(`[Preferences] Backed up legacy desensitize rules to ${backupPath}`)
  }

  private writePreferences(preferences: Preferences): void {
    const dir = path.dirname(this.filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(this.filePath, JSON.stringify(preferences, null, 2), 'utf-8')
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
