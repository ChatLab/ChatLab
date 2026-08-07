import assert from 'node:assert/strict'
import test from 'node:test'
import { nextTick, ref } from 'vue'
import { watchLazyOverlayVisibility } from './lazy-overlay-visibility'

test('runs overlay initialization when a lazy-mounted component starts visible', async () => {
  const visible = ref(true)
  const observed: boolean[] = []
  const stop = watchLazyOverlayVisibility(visible, (value) => {
    observed.push(value)
  })

  assert.deepEqual(observed, [true])

  visible.value = false
  await nextTick()
  assert.deepEqual(observed, [true, false])
  stop()
})
