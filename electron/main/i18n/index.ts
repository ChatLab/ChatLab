/**
 * 主进程国际化模块
 *
 * 基于 i18next，提供主进程的多语言支持。
 * 语言设置持久化在 settings/locale.json 中，
 * 并通过 IPC 'locale:change' 与渲染进程同步。
 */

import i18next from 'i18next'
import { app, ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { getSettingsDir, ensureDir } from '../paths'
import zhCN from './locales/zh-CN'
import enUS from './locales/en-US'
import zhTW from './locales/zh-TW'
import jaJP from './locales/ja-JP'

const LOCALE_FILE = 'locale.json'

/**
 * 获取 locale 配置文件路径
 */
function getLocaleFilePath(): string {
  return path.join(getSettingsDir(), LOCALE_FILE)
}

/**
 * 保存语言设置到文件
 */
function saveLocale(lng: string): void {
  try {
    ensureDir(getSettingsDir())
    fs.writeFileSync(getLocaleFilePath(), JSON.stringify({ locale: lng }, null, 2), 'utf-8')
  } catch (err) {
    console.error('[i18n] Failed to save locale:', err)
  }
}

/**
 * 从系统 locale 探测应用 locale
 */
function detectSystemLocale(): string {
  const sysLocale = app.getLocale()
  if (sysLocale === 'zh-TW' || sysLocale === 'zh-Hant') return 'zh-TW'
  if (sysLocale.startsWith('zh')) return 'zh-CN'
  if (sysLocale.startsWith('ja')) return 'ja-JP'
  return 'en-US'
}

/**
 * 初始化主进程国际化
 *
 * 优先级：settings/locale.json > app.getLocale() 系统检测 > en-US 默认
 * 同时注册 IPC 监听器接收渲染进程的语言切换请求
 */
export async function initLocale(): Promise<void> {
  let lng = 'en-US'

  try {
    const filePath = getLocaleFilePath()
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      if (data.locale) lng = data.locale
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
      saveLocale(newLocale)
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

/**
 * 获取当前 locale
 */
export const getLocale = (): string => i18next.language

/**
 * 判断当前是否为中文环境（兼容现有 isChineseLocale 模式）
 */
export const isChineseLocale = (): boolean => i18next.language.startsWith('zh')
