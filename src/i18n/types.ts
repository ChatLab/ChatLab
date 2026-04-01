/**
 * 支持的语言类型
 */
export type LocaleType = 'zh-CN' | 'en-US' | 'zh-TW' | 'ja-JP'

/**
 * 语言配置项
 */
export interface LocaleOption {
  code: LocaleType
  name: string
  nativeName: string
}

/**
 * 可用的语言列表
 */
export const availableLocales: LocaleOption[] = [
  { code: 'en-US', name: 'English (US)', nativeName: 'English' },
  { code: 'zh-CN', name: 'Chinese (Simplified)', nativeName: '简体中文' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', nativeName: '繁體中文' },
  { code: 'ja-JP', name: 'Japanese', nativeName: '日本語' },
]

/**
 * 所有合法的 locale code 集合，用于校验
 */
const validLocales = new Set<string>(availableLocales.map((l) => l.code))

/**
 * 校验是否为合法的 locale code
 */
export function isValidLocale(locale: string): locale is LocaleType {
  return validLocales.has(locale)
}

/**
 * 默认语言
 */
export const defaultLocale: LocaleType = 'zh-CN'

/**
 * 检测系统语言
 */
export function detectSystemLocale(): LocaleType {
  const systemLocale = navigator.language
  if (systemLocale === 'zh-TW' || systemLocale === 'zh-Hant') {
    return 'zh-TW'
  }
  if (systemLocale.startsWith('zh')) {
    return 'zh-CN'
  }
  if (systemLocale.startsWith('ja')) {
    return 'ja-JP'
  }
  return 'en-US'
}

// ========== Locale 辅助函数 ==========

/**
 * 判断是否为中文系 locale（zh-CN / zh-TW），
 * 用于分词策略、条数后缀、AI prompt 语言等场景
 */
export function isChineseLike(locale: string): boolean {
  return locale.startsWith('zh')
}

/**
 * locale -> dayjs locale 映射
 */
const dayjsLocaleMap: Record<LocaleType, string> = {
  'zh-CN': 'zh-cn',
  'zh-TW': 'zh-tw',
  'en-US': 'en',
  'ja-JP': 'ja',
}

export function getDayjsLocale(locale: LocaleType): string {
  return dayjsLocaleMap[locale] ?? 'en'
}

/**
 * 功能模块的语言支持配置
 * 某些功能可能只支持特定语言
 */
export interface FeatureLocaleSupport {
  /** 功能标识 */
  feature: string
  /** 支持的语言列表，如果为空则支持所有语言 */
  supportedLocales: LocaleType[]
}

/**
 * 功能语言限制配置
 * 用于控制某些功能只在特定语言下显示
 */
export const featureLocaleRestrictions: Record<string, LocaleType[]> = {
  groupRanking: ['zh-CN', 'zh-TW'],
}

/**
 * 检查功能是否支持当前语言
 */
export function isFeatureSupported(feature: string, currentLocale: LocaleType): boolean {
  const supportedLocales = featureLocaleRestrictions[feature]
  if (!supportedLocales || supportedLocales.length === 0) {
    return true
  }
  return supportedLocales.includes(currentLocale)
}
