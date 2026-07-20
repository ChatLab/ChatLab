import assert from 'node:assert/strict'
import { setImmediate as waitForImmediate } from 'node:timers/promises'
import test from 'node:test'
import { effectScope, nextTick, ref } from 'vue'
import type { TimeFilter } from '@openchatlab/shared-types'
import { registerAdapter } from '@/services/registry'
import type { DataAdapter } from '@/services/data/types'
import type { WeekdayActivity } from '@/types/analysis'
import { useWeekdayActivity } from './useWeekdayActivity'

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

test('only the latest filter may update weekday activity', async () => {
  const loads = [createDeferred<WeekdayActivity[]>(), createDeferred<WeekdayActivity[]>()]
  const filters: Array<TimeFilter | undefined> = []
  let loadIndex = 0

  registerAdapter('data', {
    getWeekdayActivity: (_sessionId: string, filter?: TimeFilter) => {
      filters.push(filter)
      return loads[loadIndex++]!.promise
    },
  } as unknown as DataAdapter)

  const sessionId = ref('session-one')
  const timeFilter = ref<TimeFilter>({ startTs: 1 })
  const scope = effectScope()
  const { weekdayActivity } = scope.run(() =>
    useWeekdayActivity({
      sessionId: () => sessionId.value,
      timeFilter: () => timeFilter.value,
    })
  )!

  timeFilter.value = { startTs: 2 }
  await nextTick()
  assert.deepEqual(filters, [{ startTs: 1 }, { startTs: 2 }])

  loads[0]!.resolve([{ weekday: 1, messageCount: 1 }])
  await waitForImmediate()
  assert.equal(weekdayActivity.value.length, 0)

  loads[1]!.resolve([{ weekday: 2, messageCount: 2 }])
  await waitForImmediate()
  assert.deepEqual(weekdayActivity.value, [{ weekday: 2, messageCount: 2 }])

  scope.stop()
})
