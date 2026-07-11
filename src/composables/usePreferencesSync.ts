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
import { getUiConfig, setUiConfig } from '@/composables/useUiConfig'
import { hydrateAllStores, initBackendPersist } from '@/plugins/backendPersist'

let _synced = false

export async function initPreferencesSync(): Promise<void> {
  if (_synced) return
  _synced = true

  const svc = usePreferencesService()

  try {
    const [prefs, uiConfig, locale] = await Promise.all([svc.getPreferences(), svc.getUiConfig(), svc.getLocale()])

    // config.toml fields — not covered by the plugin
    setUiConfig(uiConfig)
    const settingsStore = useSettingsStore()
    if (uiConfig.default_session_tab) {
      settingsStore.defaultSessionTab = uiConfig.default_session_tab
    }
    if (locale) {
      settingsStore.$patch({ locale: locale as 'zh-CN' | 'en-US' | 'zh-TW' | 'ja-JP' | 'ko-KR' })
    }

    // preferences.json fields — plugin handles field-level hydration
    hydrateAllStores(prefs)
  } catch (err) {
    console.warn('[PreferencesSync] Failed to load from backend, keeping default state:', err)
  }

  // Activate write-back for preferences.json
  initBackendPersist((partial) => svc.savePreferences(partial))

  // config.toml watchers (not managed by plugin)
  setupConfigWatchers(svc)
}

function setupConfigWatchers(svc: ReturnType<typeof usePreferencesService>): void {
  const settingsStore = useSettingsStore()

  watch(
    () => settingsStore.defaultSessionTab,
    (val) => {
      svc.saveUiConfig({ default_session_tab: val }).catch((err) => {
        console.warn('[PreferencesSync] Failed to save ui config:', err)
      })
    }
  )

  watch(
    () => getUiConfig().session_gap_threshold,
    (val) => {
      svc.saveUiConfig({ session_gap_threshold: val }).catch((err) => {
        console.warn('[PreferencesSync] Failed to save ui config:', err)
      })
    }
  )

  watch(
    () => getUiConfig().summary_strategy,
    (val) => {
      svc.saveUiConfig({ summary_strategy: val }).catch((err) => {
        console.warn('[PreferencesSync] Failed to save ui config:', err)
      })
    }
  )

  watch(
    () => settingsStore.locale,
    (val) => {
      svc.saveLocale(val).catch((err) => {
        console.warn('[PreferencesSync] Failed to save locale:', err)
      })
    }
  )
}
