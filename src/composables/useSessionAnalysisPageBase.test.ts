import assert from 'node:assert/strict'
import test from 'node:test'
import { effectScope, nextTick, reactive, ref } from 'vue'
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router'
import { MessageType } from '@/types/base'
import type { DailyActivity, HourlyActivity, MemberActivity } from '@/types/analysis'
import { registerAdapter } from '@/services/registry'
import type { DataAdapter } from '@/services/data/types'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function createDeferredLoads<T>(count: number): Deferred<T>[] {
  return Array.from({ length: count }, () => createDeferred<T>())
}

function createMember(name: string): MemberActivity {
  return {
    memberId: 1,
    platformId: name,
    name,
    messageCount: 1,
    percentage: 100,
  }
}

async function flushPromises() {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

test('only the latest analysis load may update results and loading state', async (t) => {
  await t.mock.module('@/utils', {
    namedExports: {
      formatLocalizedDate: () => '',
    },
  })
  const { useSessionAnalysisPageBase } = await import('./useSessionAnalysisPageBase')

  const memberLoads = createDeferredLoads<MemberActivity[]>(2)
  const hourlyLoads = createDeferredLoads<HourlyActivity[]>(2)
  const dailyLoads = createDeferredLoads<DailyActivity[]>(2)
  const typeLoads = createDeferredLoads<Array<{ type: MessageType; count: number }>>(2)
  let loadIndex = 0

  registerAdapter('data', {
    getSession: async () => ({ id: 'session-one' }),
    getMemberActivity: () => memberLoads[loadIndex]!.promise,
    getHourlyActivity: () => hourlyLoads[loadIndex]!.promise,
    getDailyActivity: () => dailyLoads[loadIndex]!.promise,
    getMessageTypeDistribution: () => typeLoads[loadIndex++]!.promise,
  } as unknown as DataAdapter)

  t.mock.method(console, 'warn', () => undefined)
  const scope = effectScope()
  t.after(() => scope.stop())
  const route = reactive({ params: { id: 'session-one' }, query: {} }) as unknown as RouteLocationNormalizedLoaded
  const router = { replace: async () => undefined } as unknown as Router
  const currentSessionId = ref<string | null>('session-one')
  const page = scope.run(() =>
    useSessionAnalysisPageBase({
      route,
      router,
      currentSessionId,
      selectSession: () => undefined,
      defaultTab: 'insights',
      validTabIds: ['insights'],
    })
  )!

  assert.equal(page.isSessionSwitching.value, true)

  const staleLoad = page.loadAnalysisData()
  const latestLoad = page.loadAnalysisData()

  memberLoads[0]!.resolve([createMember('stale')])
  hourlyLoads[0]!.resolve([{ hour: 1, messageCount: 1 }])
  dailyLoads[0]!.resolve([{ date: '2026-01-01', messageCount: 1 }])
  typeLoads[0]!.resolve([{ type: MessageType.TEXT, count: 1 }])
  await staleLoad

  assert.equal(page.memberActivity.value.length, 0)
  assert.equal(page.isLoading.value, true)
  assert.equal(page.isSessionSwitching.value, true)

  memberLoads[1]!.resolve([createMember('latest')])
  hourlyLoads[1]!.resolve([{ hour: 2, messageCount: 2 }])
  dailyLoads[1]!.resolve([{ date: '2026-02-02', messageCount: 2 }])
  typeLoads[1]!.resolve([{ type: MessageType.IMAGE, count: 2 }])
  await latestLoad

  assert.equal(page.memberActivity.value[0]?.name, 'latest')
  assert.deepEqual(page.hourlyActivity.value, [{ hour: 2, messageCount: 2 }])
  assert.equal(page.isLoading.value, false)
  assert.equal(page.isSessionSwitching.value, false)
})

test('session loading coordinates required data, missing ranges, and non-analysis tabs', async (t) => {
  await t.mock.module('@/utils', {
    namedExports: {
      formatLocalizedDate: () => '',
    },
  })
  const { useSessionAnalysisPageBase } = await import('./useSessionAnalysisPageBase')

  const sessionLoads = createDeferredLoads<{ id: string } | null>(4)
  const memberLoads = createDeferredLoads<MemberActivity[]>(4)
  const hourlyLoads = createDeferredLoads<HourlyActivity[]>(4)
  const dailyLoads = createDeferredLoads<DailyActivity[]>(4)
  const typeLoads = createDeferredLoads<Array<{ type: MessageType; count: number }>>(4)
  let sessionLoadIndex = 0
  let analysisLoadIndex = 0

  registerAdapter('data', {
    getSession: () => sessionLoads[sessionLoadIndex++]!.promise,
    getMemberActivity: () => memberLoads[analysisLoadIndex]!.promise,
    getHourlyActivity: () => hourlyLoads[analysisLoadIndex]!.promise,
    getDailyActivity: () => dailyLoads[analysisLoadIndex]!.promise,
    getMessageTypeDistribution: () => typeLoads[analysisLoadIndex++]!.promise,
  } as unknown as DataAdapter)

  t.mock.method(console, 'warn', () => undefined)
  const scope = effectScope()
  t.after(() => scope.stop())
  const route = reactive({ params: { id: 'session-one' }, query: {} }) as unknown as RouteLocationNormalizedLoaded
  const router = { replace: async () => undefined } as unknown as Router
  const currentSessionId = ref<string | null>('session-one')
  const page = scope.run(() =>
    useSessionAnalysisPageBase({
      route,
      router,
      currentSessionId,
      selectSession: () => undefined,
      defaultTab: 'insights',
      validTabIds: ['insights', 'ranking', 'ai-chat'],
    })
  )!

  const firstAnalysisLoad = page.loadAnalysisData()
  memberLoads[0]!.resolve([createMember('session-one')])
  hourlyLoads[0]!.resolve([])
  dailyLoads[0]!.resolve([])
  typeLoads[0]!.resolve([])
  await firstAnalysisLoad

  assert.equal(page.session.value?.id ?? null, null)
  assert.equal(page.isSessionSwitching.value, true)

  sessionLoads[0]!.resolve({ id: 'session-one' })
  await flushPromises()

  assert.equal(page.session.value?.id, 'session-one')
  assert.equal(page.isSessionSwitching.value, false)

  currentSessionId.value = 'session-two'
  await nextTick()
  sessionLoads[1]!.resolve({ id: 'session-two' })
  await flushPromises()

  assert.equal(page.session.value?.id, 'session-two')
  assert.equal(page.isSessionSwitching.value, true)

  const secondAnalysisLoad = page.loadAnalysisData()
  memberLoads[1]!.resolve([createMember('session-two')])
  hourlyLoads[1]!.resolve([])
  dailyLoads[1]!.resolve([])
  typeLoads[1]!.resolve([])
  await secondAnalysisLoad

  assert.equal(page.memberActivity.value[0]?.name, 'session-two')
  assert.equal(page.isSessionSwitching.value, false)

  currentSessionId.value = 'session-three'
  await nextTick()
  sessionLoads[2]!.resolve({ id: 'session-three' })
  await flushPromises()

  assert.equal(page.isSessionSwitching.value, true)
  page.handleTimeRangeInitialized(false)
  memberLoads[2]!.resolve([createMember('session-three')])
  hourlyLoads[2]!.resolve([])
  dailyLoads[2]!.resolve([])
  typeLoads[2]!.resolve([])
  await flushPromises()

  assert.equal(page.memberActivity.value[0]?.name, 'session-three')
  assert.equal(page.isSessionSwitching.value, false)

  page.activeTab.value = 'ranking'
  await nextTick()

  assert.equal(page.isLoading.value, false)
  assert.equal(analysisLoadIndex, 3)

  page.activeTab.value = 'ai-chat'
  await nextTick()
  currentSessionId.value = 'session-four'
  await nextTick()
  sessionLoads[3]!.resolve({ id: 'session-four' })
  await flushPromises()

  assert.equal(page.isSessionSwitching.value, false)
  assert.equal(page.isLoading.value, false)
  page.timeRangeValue.value = {
    startTs: 1,
    endTs: 2,
    displayLabel: 'test',
    isFullRange: false,
    state: { mode: 'custom', customStart: '1970-01-01', customEnd: '1970-01-01' },
  }
  await nextTick()

  assert.equal(analysisLoadIndex, 3)

  page.timeRangeValue.value = null
  page.activeTab.value = 'insights'
  await nextTick()

  assert.equal(page.isLoading.value, true)
  assert.equal(analysisLoadIndex, 3)

  page.handleTimeRangeInitialized(false)
  assert.equal(analysisLoadIndex, 4)

  memberLoads[3]!.resolve([createMember('session-four')])
  hourlyLoads[3]!.resolve([])
  dailyLoads[3]!.resolve([])
  typeLoads[3]!.resolve([])
  await flushPromises()

  assert.equal(page.memberActivity.value[0]?.name, 'session-four')
  assert.equal(page.isLoading.value, false)
})

test('returning to insights reuses analytics for the unchanged session and time range', async (t) => {
  await t.mock.module('@/utils', {
    namedExports: {
      formatLocalizedDate: () => '',
    },
  })
  const { useSessionAnalysisPageBase } = await import('./useSessionAnalysisPageBase')

  let analysisLoadCount = 0
  registerAdapter('data', {
    getSession: async () => ({ id: 'session-one' }),
    getMemberActivity: async () => [createMember('session-one')],
    getHourlyActivity: async () => [],
    getDailyActivity: async () => [],
    getMessageTypeDistribution: async () => {
      analysisLoadCount++
      return []
    },
  } as unknown as DataAdapter)

  t.mock.method(console, 'warn', () => undefined)
  const scope = effectScope()
  t.after(() => scope.stop())
  const route = reactive({ params: { id: 'session-one' }, query: {} }) as unknown as RouteLocationNormalizedLoaded
  const router = { replace: async () => undefined } as unknown as Router
  const currentSessionId = ref<string | null>('session-one')
  const page = scope.run(() =>
    useSessionAnalysisPageBase({
      route,
      router,
      currentSessionId,
      selectSession: () => undefined,
      defaultTab: 'ai-chat',
      validTabIds: ['insights', 'ai-chat'],
    })
  )!

  page.timeRangeValue.value = {
    startTs: 1,
    endTs: 2,
    displayLabel: 'test',
    isFullRange: false,
    state: { mode: 'custom', customStart: '1970-01-01', customEnd: '1970-01-01' },
  }
  await nextTick()

  page.activeTab.value = 'insights'
  await flushPromises()

  assert.equal(analysisLoadCount, 1)
  assert.equal(page.isLoading.value, false)

  page.activeTab.value = 'ai-chat'
  await nextTick()
  page.activeTab.value = 'insights'
  await flushPromises()

  assert.equal(analysisLoadCount, 1)
  assert.equal(page.isLoading.value, false)
})
