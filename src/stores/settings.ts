import { defineStore } from 'pinia'
import { ref } from 'vue'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/zh-tw'
import 'dayjs/locale/en'
import 'dayjs/locale/ja'
import { type LocaleType, setLocale as setI18nLocale, getLocale, getDayjsLocale } from '@/i18n'
import type { PreprocessConfig } from '@electron/preload/index'

const LOCALE_SET_KEY = 'chatlab_locale_set_by_user'

export const useSettingsStore = defineStore(
  'settings',
  () => {
    const locale = ref<LocaleType>(getLocale())

    const defaultSessionTab = ref<'overview' | 'ai-chat'>('overview')

    const debugMode = ref(false)

    function setDebugMode(enabled: boolean) {
      debugMode.value = enabled
      window.electron?.ipcRenderer.send('app:setDebugMode', enabled)
    }

    const aiPreprocessConfig = ref<PreprocessConfig>({
      dataCleaning: true,
      mergeConsecutive: false,
      mergeWindowSeconds: 180,
      blacklistKeywords: [],
      denoise: false,
      desensitize: false,
      desensitizeRules: [],
      anonymizeNames: false,
    })

    /**
     * 确保脱敏规则已初始化（首次使用或升级时通过 IPC 从主进程获取）
     */
    async function ensureDesensitizeRules() {
      if (aiPreprocessConfig.value.desensitizeRules.length === 0) {
        aiPreprocessConfig.value.desensitizeRules = await window.aiApi.getDefaultDesensitizeRules(locale.value)
      }
    }

    /**
     * 切换语言
     */
    async function setLocale(newLocale: LocaleType) {
      locale.value = newLocale

      localStorage.setItem(LOCALE_SET_KEY, 'true')

      setI18nLocale(newLocale)

      dayjs.locale(getDayjsLocale(newLocale))

      window.electron?.ipcRenderer.send('locale:change', newLocale)

      // Vue 响应式 Proxy 无法通过 Electron IPC structured clone，需转为普通对象
      const plainRules = JSON.parse(JSON.stringify(aiPreprocessConfig.value.desensitizeRules))
      aiPreprocessConfig.value.desensitizeRules = await window.aiApi.mergeDesensitizeRules(plainRules, newLocale)
    }

    /**
     * 初始化语言设置
     * 应在应用启动时调用
     */
    async function initLocale() {
      const i18nLocale = getLocale()
      if (locale.value !== i18nLocale) {
        const hasUserSetLocale = localStorage.getItem(LOCALE_SET_KEY)
        if (!hasUserSetLocale) {
          locale.value = i18nLocale
        } else {
          setI18nLocale(locale.value)
        }
      }

      dayjs.locale(getDayjsLocale(locale.value))

      await ensureDesensitizeRules()

      window.electron?.ipcRenderer.send('app:setDebugMode', debugMode.value)
    }

    return {
      locale,
      setLocale,
      initLocale,
      defaultSessionTab,
      debugMode,
      setDebugMode,
      aiPreprocessConfig,
      ensureDesensitizeRules,
    }
  },
  {
    persist: true,
  }
)
