import { get, patch } from '../utils/http'
import type { PreferencesAdapter, Preferences, PresentationPreferences, UiConfig } from './types'

export class FetchPreferencesAdapter implements PreferencesAdapter {
  getPresentationPreferences(): Promise<PresentationPreferences> {
    return get<PresentationPreferences>('/preferences/bootstrap')
  }

  getPreferences(): Promise<Preferences> {
    return get<Preferences>('/preferences')
  }

  savePreferences(partial: Partial<Preferences>): Promise<{ success: boolean; error?: string }> {
    return patch<{ success: boolean; error?: string }>('/preferences', partial)
  }

  getUiConfig(): Promise<UiConfig> {
    return get<UiConfig>('/preferences/ui-config')
  }

  saveUiConfig(partial: Partial<UiConfig>): Promise<{ success: boolean; error?: string }> {
    return patch<{ success: boolean; error?: string }>('/preferences/ui-config', partial)
  }

  async getLocale(): Promise<string> {
    const result = await get<{ lang: string }>('/preferences/locale')
    return result.lang
  }

  saveLocale(lang: string): Promise<{ success: boolean; error?: string }> {
    return patch<{ success: boolean; error?: string }>('/preferences/locale', { lang })
  }
}
