import type { Preferences, PreferencesAdapter, UiConfig } from './types'

const PREFERENCES_KEY = 'chatlab:web-wasm:preferences'
const UI_CONFIG_KEY = 'chatlab:web-wasm:ui-config'
const LOCALE_KEY = 'chatlab:web-wasm:locale'

const DEFAULT_UI_CONFIG: UiConfig = {
  default_session_tab: 'overview',
  session_gap_threshold: 1800,
  summary_strategy: 'standard',
}

export class BrowserPreferencesAdapter implements PreferencesAdapter {
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'>

  constructor(storage?: Pick<Storage, 'getItem' | 'setItem'>) {
    this.storage = storage ?? globalThis.localStorage ?? createMemoryStorage()
  }

  async getPreferences(): Promise<Preferences> {
    return this.readJson(PREFERENCES_KEY, {} as Preferences)
  }

  async savePreferences(partial: Partial<Preferences>): Promise<{ success: boolean; error?: string }> {
    return this.mergeJson(PREFERENCES_KEY, partial)
  }

  async getUiConfig(): Promise<UiConfig> {
    return this.readJson(UI_CONFIG_KEY, DEFAULT_UI_CONFIG)
  }

  async saveUiConfig(partial: Partial<UiConfig>): Promise<{ success: boolean; error?: string }> {
    return this.mergeJson(UI_CONFIG_KEY, partial, DEFAULT_UI_CONFIG)
  }

  async getLocale(): Promise<string> {
    return this.storage.getItem(LOCALE_KEY) ?? ''
  }

  async saveLocale(lang: string): Promise<{ success: boolean; error?: string }> {
    try {
      this.storage.setItem(LOCALE_KEY, lang)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private readJson<T>(key: string, fallback: T): T {
    try {
      const raw = this.storage.getItem(key)
      if (!raw) return structuredClone(fallback)
      return { ...structuredClone(fallback), ...(JSON.parse(raw) as T) }
    } catch {
      return structuredClone(fallback)
    }
  }

  private async mergeJson<T extends object>(
    key: string,
    partial: Partial<T>,
    fallback = {} as T
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const current = this.readJson(key, fallback)
      this.storage.setItem(key, JSON.stringify({ ...current, ...partial }))
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}

function createMemoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  }
}
