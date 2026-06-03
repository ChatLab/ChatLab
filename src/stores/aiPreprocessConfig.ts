import type { PreprocessConfig } from '@electron/preload/index'

export function shouldEnsureDesensitizeRulesBeforeSerialize(
  config: Pick<PreprocessConfig, 'desensitize' | 'desensitizeRules'>
): boolean {
  return config.desensitize && !config.desensitizeRules.some((rule) => rule.builtin)
}

export function buildSerializablePreprocessConfig(config: PreprocessConfig) {
  const hasPreprocess =
    config.dataCleaning ||
    config.mergeConsecutive ||
    config.blacklistKeywords.length > 0 ||
    config.denoise ||
    config.desensitize ||
    config.anonymizeNames

  if (!hasPreprocess) return undefined
  return {
    dataCleaning: config.dataCleaning,
    mergeConsecutive: config.mergeConsecutive,
    mergeWindowSeconds: config.mergeWindowSeconds,
    blacklistKeywords: [...config.blacklistKeywords],
    denoise: config.denoise,
    desensitize: config.desensitize,
    desensitizeRules: config.desensitizeRules.map((rule) => ({
      ...rule,
      locales: [...rule.locales],
    })),
    anonymizeNames: config.anonymizeNames,
  }
}
