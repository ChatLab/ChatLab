/**
 * Main process i18n module
 *
 * Uses i18next for multi-language support.
 * Locale is persisted in config.toml [locale] lang and synced
 * with the renderer process via IPC 'locale:change'.
 */

import i18next from 'i18next'
import { app, ipcMain } from 'electron'
import { loadConfig, writeConfigField } from '@openchatlab/config'
import zhCN from './locales/zh-CN'
import enUS from './locales/en-US'
import zhTW from './locales/zh-TW'
import jaJP from './locales/ja-JP'

function detectSystemLocale(): string {
  const sysLocale = app.getLocale()
  if (sysLocale === 'zh-TW' || sysLocale === 'zh-Hant') return 'zh-TW'
  if (sysLocale.startsWith('zh')) return 'zh-CN'
  if (sysLocale.startsWith('ja')) return 'ja-JP'
  return 'en-US'
}

export async function initLocale(): Promise<void> {
  let lng = 'en-US'

  try {
    const config = loadConfig()
    if (config.locale.lang) {
      lng = config.locale.lang
    } else {
      lng = detectSystemLocale()
    }
  } catch (e) {
    console.error('[i18n] Error loading locale config:', e)
  }

  await i18next.init({
    lng,
    fallbackLng: 'en-US',
    resources: {
      'zh-CN': { translation: zhCN },
      'en-US': { translation: enUS },
      'zh-TW': { translation: zhTW },
      'ja-JP': { translation: jaJP },
    },
    interpolation: { escapeValue: false },
  })

  console.log(`[i18n] Initialized with locale: ${lng}`)

  ipcMain.on('locale:change', async (_event, newLocale: string) => {
    if (newLocale !== i18next.language) {
      await i18next.changeLanguage(newLocale)
      try {
        writeConfigField('locale', 'lang', newLocale)
      } catch (err) {
        console.error('[i18n] Failed to persist locale:', err)
      }
      console.log(`[i18n] Locale changed to: ${newLocale}`)
    }
  })
}

/**
 * 翻译函数
 * @param key 翻译 key，如 'update.newVersionTitle'
 * @param options 插值参数，如 { version: '1.0.0' }
 */
export const t = (key: string, options?: Record<string, unknown>): string => i18next.t(key, options)
