import assert from 'node:assert/strict'
import { setImmediate as waitForImmediate } from 'node:timers/promises'
import test from 'node:test'
import { effectScope } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { Preferences, PreferencesAdapter, PresentationPreferences, UiConfig } from '@/services'
import { registerAdapter } from '@/services/registry'

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  }
}

test('hydrates delayed behavioral config without overwriting or losing early user edits', async () => {
  Object.defineProperties(globalThis, {
    localStorage: { configurable: true, value: createMemoryStorage() },
    sessionStorage: { configurable: true, value: createMemoryStorage() },
    window: { configurable: true, value: {} },
  })

  const preferences = createDeferred<Preferences>()
  const presentation = createDeferred<PresentationPreferences>()
  const savedUiConfig: Array<Partial<UiConfig>> = []
  const savedLocales: string[] = []

  registerAdapter('preferences', {
    getPresentationPreferences: async () => {
      throw new Error('the existing bootstrap request should be reused')
    },
    getPreferences: () => preferences.promise,
    savePreferences: async () => ({ success: true }),
    getUiConfig: async () => ({
      default_session_tab: 'insights',
      session_gap_threshold: 1800,
      summary_strategy: 'standard',
    }),
    saveUiConfig: async (partial) => {
      savedUiConfig.push(partial)
      return { success: true }
    },
    getLocale: async () => '',
    saveLocale: async (locale) => {
      savedLocales.push(locale)
      return { success: true }
    },
  } satisfies PreferencesAdapter)

  setActivePinia(createPinia())
  const { initPreferencesSync } = await import('./usePreferencesSync')
  const { getUiConfig, patchUiConfig } = await import('./useUiConfig')
  const { useSettingsStore } = await import('@/stores/settings')
  const settingsStore = useSettingsStore()
  const scope = effectScope()

  let initialization!: Promise<void>
  scope.run(() => {
    initialization = initPreferencesSync({
      presentationPromise: presentation.promise,
      hydratePresentationLocale: false,
    })
  })

  settingsStore.defaultSessionTab = 'ai-chat'
  patchUiConfig({ session_gap_threshold: 3600 })
  settingsStore.$patch({ locale: 'zh-TW' })

  assert.deepEqual(savedUiConfig, [{ default_session_tab: 'ai-chat' }, { session_gap_threshold: 3600 }])
  assert.deepEqual(savedLocales, ['zh-TW'])

  presentation.resolve({
    locale: 'ja-JP',
    uiConfig: {
      default_session_tab: 'insights',
      session_gap_threshold: 600,
      summary_strategy: 'brief',
    },
  })
  await waitForImmediate()

  assert.equal(settingsStore.defaultSessionTab, 'ai-chat')
  assert.equal(settingsStore.locale, 'zh-TW')
  assert.deepEqual(getUiConfig(), {
    default_session_tab: 'ai-chat',
    session_gap_threshold: 3600,
    summary_strategy: 'brief',
  })
  assert.deepEqual(savedUiConfig, [{ default_session_tab: 'ai-chat' }, { session_gap_threshold: 3600 }])

  patchUiConfig({ summary_strategy: 'standard' })
  assert.deepEqual(savedUiConfig, [
    { default_session_tab: 'ai-chat' },
    { session_gap_threshold: 3600 },
    { summary_strategy: 'standard' },
  ])

  preferences.resolve({} as Preferences)
  await initialization
  scope.stop()
})
