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
import { completeBackendPersistHydration, hydrateAllStores, initBackendPersist } from '@/plugins/backendPersist'
import type { PresentationPreferences } from '@/services/preferences/types'

let _synced = false

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

export async function initPreferencesSync(options: { presentationInitialized?: boolean } = {}): Promise<void> {
  if (_synced) return
  _synced = true

  const svc = usePreferencesService()

  try {
    const [prefs, presentation] = await Promise.all([
      svc.getPreferences(),
      options.presentationInitialized ? null : svc.getPresentationPreferences(),
    ])

    if (presentation) applyPresentationPreferences(presentation)

    // preferences.json fields — plugin handles field-level hydration
    hydrateAllStores(prefs)
  } catch (err) {
    console.warn('[PreferencesSync] Failed to load from backend, keeping default state:', err)
    completeBackendPersistHydration()
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
