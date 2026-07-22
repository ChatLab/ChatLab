import assert from 'node:assert/strict'
import test from 'node:test'
import { effectScope, reactive, ref } from 'vue'
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

function createMember(name: string): MemberActivity {
  return {
    memberId: 1,
    platformId: name,
    name,
    messageCount: 1,
    percentage: 100,
  }
}

test('only the latest analysis load may update results and loading state', async (t) => {
  await t.mock.module('@/utils', {
    namedExports: {
      formatLocalizedDate: () => '',
    },
  })
  const { useSessionAnalysisPageBase } = await import('./useSessionAnalysisPageBase')

  const memberLoads = [createDeferred<MemberActivity[]>(), createDeferred<MemberActivity[]>()]
  const hourlyLoads = [createDeferred<HourlyActivity[]>(), createDeferred<HourlyActivity[]>()]
  const dailyLoads = [createDeferred<DailyActivity[]>(), createDeferred<DailyActivity[]>()]
  const typeLoads = [
    createDeferred<Array<{ type: MessageType; count: number }>>(),
    createDeferred<Array<{ type: MessageType; count: number }>>(),
  ]
  let loadIndex = 0

  registerAdapter('data', {
    getSession: async () => null,
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

  const staleLoad = page.loadAnalysisData()
  const latestLoad = page.loadAnalysisData()

  memberLoads[0]!.resolve([createMember('stale')])
  hourlyLoads[0]!.resolve([{ hour: 1, messageCount: 1 }])
  dailyLoads[0]!.resolve([{ date: '2026-01-01', messageCount: 1 }])
  typeLoads[0]!.resolve([{ type: MessageType.TEXT, count: 1 }])
  await staleLoad

  assert.equal(page.memberActivity.value.length, 0)
  assert.equal(page.isLoading.value, true)

  memberLoads[1]!.resolve([createMember('latest')])
  hourlyLoads[1]!.resolve([{ hour: 2, messageCount: 2 }])
  dailyLoads[1]!.resolve([{ date: '2026-02-02', messageCount: 2 }])
  typeLoads[1]!.resolve([{ type: MessageType.IMAGE, count: 2 }])
  await latestLoad

  assert.equal(page.memberActivity.value[0]?.name, 'latest')
  assert.deepEqual(page.hourlyActivity.value, [{ hour: 2, messageCount: 2 }])
  assert.equal(page.isLoading.value, false)
})
