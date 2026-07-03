/**
 * Assemble the AI preprocess config for CLI query commands.
 *
 * Reads the user's aiPreprocessConfig from ~/.chatlab/preferences.json and merges
 * builtin locale-aware desensitize rules via mergeRulesForLocale — user preferences
 * store custom rules only, so without the merge the desensitize switch would be a no-op.
 */

import { PreferencesManager, mergeRulesForLocale, type PreprocessConfig } from '@openchatlab/node-runtime'

/** Locales that have dedicated builtin desensitize rule groups. */
const BUILTIN_RULE_LOCALES = ['zh-CN', 'en-US', 'ja-JP', 'ko-KR']

const PRIMARY_LANG_MAP: Record<string, string> = {
  zh: 'zh-CN',
  en: 'en-US',
  ja: 'ja-JP',
  ko: 'ko-KR',
}

function normalizeLocale(locale: string): string {
  if (BUILTIN_RULE_LOCALES.includes(locale)) return locale
  const primary = locale.split(/[-_]/)[0].toLowerCase()
  return PRIMARY_LANG_MAP[primary] ?? locale
}

function detectSystemLocale(): string {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().locale
    if (resolved) return resolved
  } catch {
    // fall through to env
  }
  const lang = process.env.LANG || ''
  return lang.split('.')[0] || ''
}

/**
 * Resolve the effective locale for desensitize rules:
 * config `locale.lang` first, then system locale (Intl / LANG), then zh-CN.
 */
export function resolveCliLocale(configLang?: string, systemLocale?: string): string {
  if (configLang) return normalizeLocale(configLang)
  const system = systemLocale !== undefined ? systemLocale : detectSystemLocale()
  if (system) return normalizeLocale(system)
  return 'zh-CN'
}

/**
 * Load the user's preprocess config with builtin desensitize rules merged in.
 *
 * @param systemDir directory containing preferences.json (NodePathProvider.getSystemDir())
 * @param locale effective locale from resolveCliLocale()
 */
export function loadCliPreprocessConfig(systemDir: string, locale: string): PreprocessConfig {
  const preferences = new PreferencesManager(systemDir).load()
  const config = preferences.aiPreprocessConfig
  return {
    ...config,
    desensitizeRules: mergeRulesForLocale(
      config.desensitizeRules,
      locale,
      config.desensitizeBuiltinRuleOverrides ?? {}
    ),
  }
}
