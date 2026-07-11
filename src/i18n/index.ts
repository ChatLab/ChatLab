import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import enUS from './locales/en-US'
import zhTW from './locales/zh-TW'
import jaJP from './locales/ja-JP'
import koKR from './locales/ko-KR'
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

/**
 * 创建 i18n 实例
 */
export const i18n = createI18n({
  legacy: false,
  locale: getInitialLocale(),
  fallbackLocale: 'en-US',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
    'zh-TW': zhTW,
    'ja-JP': jaJP,
    'ko-KR': koKR,
  },
})

/**
 * 动态切换语言
 */
export function setLocale(locale: LocaleType) {
  i18n.global.locale.value = locale
}

/**
 * 获取当前语言
 */
export function getLocale(): LocaleType {
  return i18n.global.locale.value as LocaleType
}

export default i18n
