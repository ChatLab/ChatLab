import assert from 'node:assert/strict'
import { setImmediate as waitForImmediate } from 'node:timers/promises'
import test from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { registerAdapter } from '@/services/registry'
import type { AIAdapter, PlatformAdapter } from '@/services'

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

test('locale-dependent desensitize rules do not wait for telemetry delivery', async () => {
  Object.defineProperties(globalThis, {
    localStorage: { configurable: true, value: createMemoryStorage() },
    sessionStorage: { configurable: true, value: createMemoryStorage() },
    window: { configurable: true, value: {} },
  })

  let releaseTelemetry: (() => void) | undefined
  const telemetryPending = new Promise<void>((resolve) => {
    releaseTelemetry = resolve
  })
  const mergedLocales: string[] = []

  registerAdapter('platform', {
    trackDailyActive: () => telemetryPending,
  } as unknown as PlatformAdapter)
  registerAdapter('ai', {
    mergeDesensitizeRules: async (_rules, locale) => {
      mergedLocales.push(locale)
      return []
    },
  } as unknown as AIAdapter)

  setActivePinia(createPinia())
  const { useSettingsStore } = await import('./settings')
  const store = useSettingsStore()

  try {
    const localeChange = store.setLocale('en-US')
    await waitForImmediate()

    assert.deepEqual(mergedLocales, ['en-US'])
    assert.equal(
      await Promise.race([
        localeChange.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 20)),
      ]),
      true
    )
  } finally {
    releaseTelemetry?.()
  }
})

test('uses the header tools layout outside debug mode without discarding the persisted side preference', async () => {
  Object.defineProperties(globalThis, {
    localStorage: { configurable: true, value: createMemoryStorage() },
    sessionStorage: { configurable: true, value: createMemoryStorage() },
    window: { configurable: true, value: {} },
  })

  setActivePinia(createPinia())
  const { useSettingsStore } = await import('./settings')
  const { useLayoutStore } = await import('./layout')
  const settingsStore = useSettingsStore()
  const layoutStore = useLayoutStore()

  layoutStore.toolsPanelPosition = 'side'
  settingsStore.debugMode = false
  assert.equal(layoutStore.effectiveToolsPanelPosition, 'header')

  settingsStore.debugMode = true
  assert.equal(layoutStore.effectiveToolsPanelPosition, 'side')

  settingsStore.debugMode = false
  assert.equal(layoutStore.toolsPanelPosition, 'side')
})
