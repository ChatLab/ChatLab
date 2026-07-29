import assert from 'node:assert/strict'
import { setImmediate as waitForImmediate } from 'node:timers/promises'
import test from 'node:test'
import type { AnalyticsEventName } from '@openchatlab/shared-types'

test('includes the current locale in an event before daily-active initialization', async (t) => {
  const events: Array<{ name: AnalyticsEventName; properties?: Record<string, unknown> }> = []

  await t.mock.module('@/i18n', {
    namedExports: {
      getLocale: () => 'zh-TW',
    },
  })
  await t.mock.module('./platform/service', {
    namedExports: {
      usePlatformService: () => ({
        trackAnalyticsEvent: async (name: AnalyticsEventName, properties?: Record<string, unknown>) => {
          events.push({ name, properties })
        },
      }),
    },
  })

  const { trackProductEvent } = await import('./product-analytics')
  trackProductEvent('feature_used', { feature_id: 'insights' })
  await waitForImmediate()

  assert.deepEqual(events, [
    {
      name: 'feature_used',
      properties: { feature_id: 'insights', app_locale: 'zh-TW' },
    },
  ])
})
