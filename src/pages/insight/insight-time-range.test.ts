import assert from 'node:assert/strict'
import test from 'node:test'
import { nextTick, ref } from 'vue'
import { watchInsightSettingsClose } from './insight-time-range'

test('refreshes annual summary after the settings modal closes', async () => {
  const showSettings = ref(false)
  let refreshCalls = 0
  const stop = watchInsightSettingsClose(showSettings, () => refreshCalls++)

  showSettings.value = true
  await nextTick()
  assert.equal(refreshCalls, 0)

  showSettings.value = false
  await nextTick()
  assert.equal(refreshCalls, 1)
  stop()
})
