import { defineStore } from 'pinia'
import { ref } from 'vue'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/zh-tw'
import 'dayjs/locale/en'
import 'dayjs/locale/ja'
import { type LocaleType, setLocale as setI18nLocale, getLocale, getDayjsLocale } from '@/i18n'
import type { PreprocessConfig } from '@electron/preload/index'
import type { AIPreprocessConfig } from '@openchatlab/shared-types'
import { useAIService } from '@/services'
import { PLATFORM_CAPABILITIES } from '@/utils/platform-capabilities'

const DESENSITIZE_RULES_SCHEMA_VERSION = 2

function serializeAiPreprocessConfig(config: PreprocessConfig): AIPreprocessConfig {
  return {
    ...config,
    desensitizeRulesSchemaVersion: DESENSITIZE_RULES_SCHEMA_VERSION,
    desensitizeBuiltinRuleOverrides: { ...(config.desensitizeBuiltinRuleOverrides ?? {}) },
    mergeWindowSeconds: config.mergeWindowSeconds ?? 180,
    desensitizeRules: config.desensitizeRules
      .filter((rule) => !rule.builtin)
      .map((rule) => ({
        ...rule,
        locales: [...rule.locales],
      })),
  }
}

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
      mergeConsecutive: true,
      mergeWindowSeconds: 180,
      blacklistKeywords: [],
      denoise: true,
      desensitize: true,
      desensitizeRulesSchemaVersion: DESENSITIZE_RULES_SCHEMA_VERSION,
      desensitizeBuiltinRuleOverrides: {},
      desensitizeRules: [],
      anonymizeNames: false,
    })

    /**
     * 确保脱敏规则已初始化（首次使用或升级时通过 IPC 从主进程获取）
     */
    async function ensureDesensitizeRules() {
      const plainRules = JSON.parse(JSON.stringify(aiPreprocessConfig.value.desensitizeRules))
      aiPreprocessConfig.value.desensitizeRules = await useAIService().mergeDesensitizeRules(
        plainRules,
        locale.value,
        aiPreprocessConfig.value.desensitizeBuiltinRuleOverrides ?? {}
      )
    }

    /**
     * 切换语言
     */
    async function setLocale(newLocale: LocaleType) {
      locale.value = newLocale

      setI18nLocale(newLocale)

      dayjs.locale(getDayjsLocale(newLocale))

      window.electron?.ipcRenderer.send('locale:change', newLocale)

      if (PLATFORM_CAPABILITIES.initializesLlm) await ensureDesensitizeRules()
    }

    /**
     * 初始化语言设置
     * 应在应用启动时调用
     */
    async function initLocale() {
      const i18nLocale = getLocale()
      if (locale.value !== i18nLocale) {
        setI18nLocale(locale.value)
      }

      dayjs.locale(getDayjsLocale(locale.value))

      if (PLATFORM_CAPABILITIES.initializesLlm) await ensureDesensitizeRules()

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
    persist: {
      pick: ['debugMode'],
      storage: localStorage,
    },
    backendPersist: {
      pick: ['aiPreprocessConfig'],
      serialize: (state) => ({
        aiPreprocessConfig: serializeAiPreprocessConfig(state.aiPreprocessConfig as PreprocessConfig),
      }),
    },
  }
)
