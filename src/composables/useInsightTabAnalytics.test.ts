import assert from 'node:assert/strict'
import test from 'node:test'
import { effectScope, ref } from 'vue'

test('only uninterrupted foreground selections count; initial views and cancellations do not', async (t) => {
  const events: Array<{ name: string; props: Record<string, unknown> }> = []
  await t.mock.module('@/services/product-analytics', {
    namedExports: { trackProductEvent: (name: string, props: Record<string, unknown>) => events.push({ name, props }) },
  })
  const { useInsightTabAnalytics } = await import('./useInsightTabAnalytics')
  const browserWindow = new EventTarget()
  let focused = true
  const browserDocument = Object.assign(new EventTarget(), { visibilityState: 'visible', hasFocus: () => focused })
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browserWindow })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: browserDocument })
  const scope = effectScope()
  t.after(() => {
    scope.stop()
    for (const [key, descriptor] of [
      ['window', originalWindow],
      ['document', originalDocument],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const active = ref(true)
  const sessionId = ref<string | null>('local-only-session')
  const routePath = ref('/private-chat/local-only-session')
  const select = scope.run(() =>
    useInsightTabAnalytics({
      chatType: 'private',
      isActive: () => active.value,
      sessionId,
      routePath: () => routePath.value,
    })
  )!
  const visits = () => events.filter(({ name }) => name === 'insight_tab_used')

  t.mock.timers.tick(5000)
  assert.deepEqual(events, [{ name: 'insight_viewed', props: { chat_type: 'private' } }])
  select('topic')
  t.mock.timers.tick(2000)
  select('relationship')
  t.mock.timers.tick(2999)
  assert.equal(visits().length, 0)
  t.mock.timers.tick(1)
  assert.deepEqual(visits(), [{ name: 'insight_tab_used', props: { chat_type: 'private', tab_id: 'relationship' } }])
  assert.equal(events.filter(({ name }) => name === 'insight_viewed').length, 2)
  t.mock.timers.tick(5000)
  assert.equal(visits().length, 1)

  const interruptions = [
    () => {
      active.value = false
    },
    () => {
      sessionId.value = 'another-local-session'
    },
    () => {
      browserWindow.dispatchEvent(new Event('blur'))
    },
    () => {
      browserDocument.visibilityState = 'hidden'
      browserDocument.dispatchEvent(new Event('visibilitychange'))
    },
    () => {
      routePath.value = '/home'
    },
  ]
  for (const interrupt of interruptions) {
    select('time-analysis')
    t.mock.timers.tick(2999)
    interrupt()
    active.value = true
    browserDocument.visibilityState = 'visible'
    t.mock.timers.tick(5000)
    assert.equal(visits().length, 1)
  }
  // A later deliberate visit qualifies again, including a return to overview.
  select('overview')
  t.mock.timers.tick(3000)
  assert.equal(visits().length, 2)

  // Loading can finish in a hidden tab or an unfocused window. Neither is a view yet.
  const views = () => events.filter(({ name }) => name === 'insight_viewed').length
  for (const [visibility, returnEvent] of [
    ['hidden', 'focus'],
    ['visible', 'focus'],
    ['hidden', 'visibilitychange'],
  ]) {
    active.value = false
    focused = false
    browserDocument.visibilityState = visibility
    const before = views()
    active.value = true
    assert.equal(views(), before)
    if (returnEvent === 'focus') {
      browserDocument.visibilityState = 'visible'
      browserDocument.dispatchEvent(new Event('visibilitychange'))
    } else {
      focused = true
      browserWindow.dispatchEvent(new Event('focus'))
    }
    assert.equal(views(), before)
    focused = true
    browserDocument.visibilityState = 'visible'
    if (returnEvent === 'focus') browserWindow.dispatchEvent(new Event('focus'))
    else browserDocument.dispatchEvent(new Event('visibilitychange'))
    assert.equal(views(), before + 1)
    browserWindow.dispatchEvent(new Event('focus'))
    browserDocument.dispatchEvent(new Event('visibilitychange'))
    assert.equal(views(), before + 1)
    t.mock.timers.tick(5000)
    assert.equal(visits().length, 2)
  }

  // Returning to the foreground cannot revive a cancelled dwell visit.
  select('topic')
  t.mock.timers.tick(2000)
  focused = false
  browserWindow.dispatchEvent(new Event('blur'))
  focused = true
  browserWindow.dispatchEvent(new Event('focus'))
  t.mock.timers.tick(5000)
  assert.equal(visits().length, 2)

  // Leaving before the first foreground view must discard the pending denominator event.
  active.value = false
  focused = false
  active.value = true
  const beforeLeaving = views()
  active.value = false
  focused = true
  browserWindow.dispatchEvent(new Event('focus'))
  assert.equal(views(), beforeLeaving)
  active.value = true
  select('topic')
  scope.stop()
  t.mock.timers.tick(3000)
  assert.equal(visits().length, 2)
  assert.ok(events.every(({ props }) => !('session_id' in props)))
})
