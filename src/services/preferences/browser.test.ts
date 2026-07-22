import assert from 'node:assert/strict'
import test from 'node:test'
import { BrowserPreferencesAdapter } from './browser'

function createMemoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  }
}

test('persists the Web WASM locale in browser-local storage', async () => {
  const adapter = new BrowserPreferencesAdapter(createMemoryStorage())

  assert.equal(await adapter.getLocale(), '')
  assert.deepEqual(await adapter.saveLocale('zh-CN'), { success: true })
  assert.equal(await adapter.getLocale(), 'zh-CN')
})

test('merges browser-local UI config updates with defaults', async () => {
  const adapter = new BrowserPreferencesAdapter(createMemoryStorage())

  assert.deepEqual(await adapter.getUiConfig(), {
    default_session_tab: 'insights',
    session_gap_threshold: 1800,
    summary_strategy: 'standard',
  })
  assert.deepEqual(await adapter.saveUiConfig({ session_gap_threshold: 3600 }), { success: true })
  assert.equal((await adapter.getUiConfig()).session_gap_threshold, 3600)
})

test('normalizes the released browser overview preference to insights', async () => {
  const storage = createMemoryStorage()
  storage.setItem(
    'chatlab:web-wasm:ui-config',
    JSON.stringify({ default_session_tab: 'overview', session_gap_threshold: 1800, summary_strategy: 'standard' })
  )
  const adapter = new BrowserPreferencesAdapter(storage)

  assert.equal((await adapter.getUiConfig()).default_session_tab, 'insights')
})
