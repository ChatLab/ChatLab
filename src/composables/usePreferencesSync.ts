/**
 * Preferences Sync — load backend data on startup, wire up persistence.
 *
 * Hydration and reactive watchers for preferences.json are handled by
 * the backendPersist Pinia plugin. This module only orchestrates:
 * 1. Loading preferences.json / config.toml / locale from backend
 * 2. Feeding data to hydrateAllStores() and uiConfig/locale state
 * 3. Activating the plugin's save pipeline
 */

import { watch } from 'vue'
import { usePreferencesService } from '@/services'
import { useSettingsStore } from '@/stores/settings'
import { getUiConfig, patchUiConfig, setUiConfig } from '@/composables/useUiConfig'
import { completeBackendPersistHydration, hydrateAllStores, initBackendPersist } from '@/plugins/backendPersist'
import type { PresentationPreferences, UiConfig } from '@/services/preferences/types'

type ConfigField = keyof UiConfig | 'locale'

export interface InitPreferencesSyncOptions {
  presentationInitialized?: boolean
  presentationPromise?: Promise<PresentationPreferences>
  hydratePresentationLocale?: boolean
}

let _synced = false
let configHydrationSettled = false
let applyingConfigHydration = false
const dirtyConfigFields = new Set<ConfigField>()

export function loadPresentationPreferences(): Promise<PresentationPreferences> {
  return usePreferencesService().getPresentationPreferences()
}

export function applyPresentationPreferences(presentation: PresentationPreferences): void {
  setUiConfig(presentation.uiConfig)
  const settingsStore = useSettingsStore()
  if (presentation.uiConfig.default_session_tab) {
    settingsStore.defaultSessionTab = presentation.uiConfig.default_session_tab
  }
  if (presentation.locale) {
    settingsStore.$patch({ locale: presentation.locale as 'zh-CN' | 'en-US' | 'zh-TW' | 'ja-JP' })
  }
}

function markConfigFieldDirty(field: ConfigField): void {
  if (!configHydrationSettled) dirtyConfigFields.add(field)
}

function settleConfigHydration(): void {
  configHydrationSettled = true
  dirtyConfigFields.clear()
}

function hydratePresentationPreferences(presentation: PresentationPreferences, hydrateLocale: boolean): void {
  const settingsStore = useSettingsStore()
  const currentUiConfig = getUiConfig()
  const uiConfig: UiConfig = {
    default_session_tab: dirtyConfigFields.has('default_session_tab')
      ? settingsStore.defaultSessionTab
      : presentation.uiConfig.default_session_tab,
    session_gap_threshold: dirtyConfigFields.has('session_gap_threshold')
      ? currentUiConfig.session_gap_threshold
      : presentation.uiConfig.session_gap_threshold,
    summary_strategy: dirtyConfigFields.has('summary_strategy')
      ? currentUiConfig.summary_strategy
      : presentation.uiConfig.summary_strategy,
  }

  applyingConfigHydration = true
  try {
    setUiConfig(uiConfig)
    settingsStore.defaultSessionTab = uiConfig.default_session_tab
    // Desktop / CLI Web 超时后只补齐行为配置，避免首屏结束后再切换语言。
    if (hydrateLocale && presentation.locale && !dirtyConfigFields.has('locale')) {
      settingsStore.$patch({ locale: presentation.locale as 'zh-CN' | 'en-US' | 'zh-TW' | 'ja-JP' })
    }
  } finally {
    applyingConfigHydration = false
    settleConfigHydration()
  }
}

export async function initPreferencesSync(options: InitPreferencesSyncOptions = {}): Promise<void> {
  if (_synced) return
  _synced = true

  const svc = usePreferencesService()
  configHydrationSettled = options.presentationInitialized === true
  setupConfigWatchers(svc)

  const presentationTask = options.presentationInitialized
    ? Promise.resolve()
    : (options.presentationPromise ?? svc.getPresentationPreferences())
        .then((presentation) =>
          hydratePresentationPreferences(presentation, options.hydratePresentationLocale !== false)
        )
        .catch((err) => {
          console.warn('[PreferencesSync] Failed to load presentation preferences, keeping current state:', err)
          settleConfigHydration()
        })

  const preferencesTask = svc
    .getPreferences()
    .then((prefs) => {
      // preferences.json fields — plugin handles field-level hydration
      hydrateAllStores(prefs)
    })
    .catch((err) => {
      console.warn('[PreferencesSync] Failed to load preferences, keeping current state:', err)
      completeBackendPersistHydration()
    })

  await preferencesTask

  // Activate write-back for preferences.json
  initBackendPersist((partial) => svc.savePreferences(partial))

  await presentationTask
}

function setupConfigWatchers(svc: ReturnType<typeof usePreferencesService>): void {
  const settingsStore = useSettingsStore()

  watch(
    () => settingsStore.defaultSessionTab,
    (val) => {
      if (applyingConfigHydration) return
      markConfigFieldDirty('default_session_tab')
      patchUiConfig({ default_session_tab: val })
      svc.saveUiConfig({ default_session_tab: val }).catch((err) => {
        console.warn('[PreferencesSync] Failed to save ui config:', err)
      })
    },
    { flush: 'sync' }
  )

  watch(
    () => getUiConfig().session_gap_threshold,
    (val) => {
      if (applyingConfigHydration) return
      markConfigFieldDirty('session_gap_threshold')
      svc.saveUiConfig({ session_gap_threshold: val }).catch((err) => {
        console.warn('[PreferencesSync] Failed to save ui config:', err)
      })
    },
    { flush: 'sync' }
  )

  watch(
    () => getUiConfig().summary_strategy,
    (val) => {
      if (applyingConfigHydration) return
      markConfigFieldDirty('summary_strategy')
      svc.saveUiConfig({ summary_strategy: val }).catch((err) => {
        console.warn('[PreferencesSync] Failed to save ui config:', err)
      })
    },
    { flush: 'sync' }
  )

  watch(
    () => settingsStore.locale,
    (val) => {
      if (applyingConfigHydration) return
      markConfigFieldDirty('locale')
      svc.saveLocale(val).catch((err) => {
        console.warn('[PreferencesSync] Failed to save locale:', err)
      })
    },
    { flush: 'sync' }
  )
}
