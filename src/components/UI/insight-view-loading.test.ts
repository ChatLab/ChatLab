import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { createInsightViewLoadingBinding } from './insight-view-loading'

test('keeps custom async views registered until their loading state finishes', async () => {
  const pendingLoaders = ref(0)
  const binding = createInsightViewLoadingBinding({
    register: () => {
      pendingLoaders.value++
      let active = true
      return () => {
        if (!active) return
        active = false
        pendingLoaders.value--
      }
    },
  })

  binding.sync(true)
  binding.sync(true)
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(pendingLoaders.value, 1)

  binding.sync(false)
  assert.equal(pendingLoaders.value, 0)

  binding.sync(true)
  binding.dispose()
  assert.equal(pendingLoaders.value, 0)
})
