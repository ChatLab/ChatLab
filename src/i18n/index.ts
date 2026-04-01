import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import enUS from './locales/en-US'
import zhTW from './locales/zh-TW'
import jaJP from './locales/ja-JP'
import { detectSystemLocale, isValidLocale, type LocaleType } from './types'

// 导出类型
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

// 用于标记用户是否明确设置过语言的 key
const LOCALE_SET_KEY = 'chatlab_locale_set_by_user'
const PINIA_SETTINGS_KEY = 'settings' // Pinia persist 的 key

/**
 * 获取初始语言（在应用启动时，越早越好）
 * - 如果用户之前设置过语言，从 Pinia persist 恢复
 * - 如果是首次使用，检测系统语言
 */
function getInitialLocale(): LocaleType {
  const hasUserSetLocale = localStorage.getItem(LOCALE_SET_KEY)

  if (hasUserSetLocale) {
    try {
      const piniaSettings = localStorage.getItem(PINIA_SETTINGS_KEY)
      if (piniaSettings) {
        const parsed = JSON.parse(piniaSettings)
        if (isValidLocale(parsed.locale)) {
          return parsed.locale
        }
      }
    } catch {
      // 解析失败，使用系统语言
    }
  }

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
