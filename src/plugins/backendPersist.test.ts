import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from 'vue'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import type { Preferences } from '@openchatlab/shared-types'
import { backendPersistPlugin, hydrateAllStores, initBackendPersist } from './backendPersist'

test('backend hydration preserves edits made while preferences are still loading', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })

  const pinia = createPinia()
  pinia.use(backendPersistPlugin)
  createApp({ render: () => null }).use(pinia)
  setActivePinia(pinia)

  const useTestStore = defineStore('backend-persist-hydration-test', {
    state: () => ({ localField: 'default', untouchedField: 'default' }),
    backendPersist: { pick: ['localField', 'untouchedField'] },
  })
  const store = useTestStore()
  const saved: Array<Record<string, unknown>> = []

  store.localField = 'local edit'
  hydrateAllStores({
    localField: 'stale backend value',
    untouchedField: 'backend value',
  } as unknown as Preferences)
  initBackendPersist(async (partial) => {
    saved.push(partial as Record<string, unknown>)
  })

  assert.equal(store.localField, 'local edit')
  assert.equal(store.untouchedField, 'backend value')

  t.mock.timers.tick(500)
  await Promise.resolve()
  assert.deepEqual(saved, [{ localField: 'local edit', untouchedField: 'backend value' }])
})
