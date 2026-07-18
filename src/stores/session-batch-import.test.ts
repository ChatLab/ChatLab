import assert from 'node:assert/strict'
import { setImmediate as waitForImmediate } from 'node:timers/promises'
import test from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { registerAdapter } from '@/services/registry'
import type { DataAdapter, ImportAdapter, SessionIndexAdapter } from '@/services'

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
    setItem: (key, value) => values.set(key, value),
  }
}

test('batch import accepts browser File objects and processes them serially', async () => {
  Object.defineProperties(globalThis, {
    localStorage: { configurable: true, value: createMemoryStorage() },
    sessionStorage: { configurable: true, value: createMemoryStorage() },
  })

  const importCalls: File[] = []
  let activeImports = 0
  let maxActiveImports = 0

  registerAdapter('import', {
    async importFile(source: File | string) {
      assert.ok(source instanceof File)
      importCalls.push(source)
      activeImports++
      maxActiveImports = Math.max(maxActiveImports, activeImports)
      await waitForImmediate()
      activeImports--
      return {
        success: true,
        sessionId: `session-${importCalls.length}`,
        importMode: 'incremental' as const,
        newMessageCount: 1,
        duplicateCount: 0,
      }
    },
  } as ImportAdapter)
  registerAdapter('data', {
    getSessions: async () => [],
    tryApplyOwnerProfile: async () => ({ applied: false }),
  } as unknown as DataAdapter)
  registerAdapter('session-index', {
    generate: async () => undefined,
  } as unknown as SessionIndexAdapter)

  setActivePinia(createPinia())
  const { useSessionStore } = await import('./session')
  const store = useSessionStore()
  const files = [new File(['a'], 'first.json'), new File(['b'], 'second.jsonl')]

  const result = await store.importFiles(files)

  assert.deepEqual(
    importCalls.map((file) => file.name),
    ['first.json', 'second.jsonl']
  )
  assert.equal(maxActiveImports, 1)
  assert.equal(result.success, 2)
  assert.equal(result.failed, 0)
  assert.deepEqual(
    result.files.map((file) => ({ name: file.name, status: file.status })),
    [
      { name: 'first.json', status: 'success' },
      { name: 'second.jsonl', status: 'success' },
    ]
  )
})
