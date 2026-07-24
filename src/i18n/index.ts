import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import enUS from './locales/en-US'
import zhTW from './locales/zh-TW'
import jaJP from './locales/ja-JP'
import { detectSystemLocale, type LocaleType } from './types'

export type { LocaleType } from './types'
export {
  availableLocales,
  defaultLocale,
  detectSystemLocale,
  isFeatureSupported,
  featureLocaleRestrictions,
  isChineseLike,
  getDayjsLocale,
  isValidLocale,
} from './types'

/**
 * Determine initial locale via system language detection.
 * The authoritative value is loaded async from config.toml during initPreferencesSync().
 */
function getInitialLocale(): LocaleType {
  return detectSystemLocale()
}

function setDocumentLocale(locale: LocaleType): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale
}

const initialLocale = getInitialLocale()
setDocumentLocale(initialLocale)

/**
 * 创建 i18n 实例
 */
export const i18n = createI18n({
  legacy: false,
  locale: initialLocale,
  fallbackLocale: 'en-US',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
    'zh-TW': zhTW,
    'ja-JP': jaJP,
  },
})

/**
 * 动态切换语言
 */
export function setLocale(locale: LocaleType) {
  i18n.global.locale.value = locale
  setDocumentLocale(locale)
}

/**
 * 获取当前语言
 */
export function getLocale(): LocaleType {
  return i18n.global.locale.value as LocaleType
}

export default i18n
