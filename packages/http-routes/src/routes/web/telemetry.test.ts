import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { registerTelemetryRoutes } from './telemetry'

describe('telemetry routes', () => {
  it('reads and writes analytics enabled state through the shared service', async () => {
    let enabled = true
    const app = Fastify()
    registerTelemetryRoutes(app, {
      analyticsService: {
        getEnabled: () => enabled,
        setEnabled: (next: boolean) => {
          enabled = next
        },
        trackDailyActive: async () => {},
        track: async () => true,
      },
    })

    await app.ready()
    try {
      const before = await app.inject({ method: 'GET', url: '/_web/telemetry/enabled' })
      assert.equal(before.statusCode, 200)
      assert.deepEqual(before.json(), { enabled: true })

      const update = await app.inject({
        method: 'POST',
        url: '/_web/telemetry/enabled',
        payload: { enabled: false },
      })
      assert.equal(update.statusCode, 200)
      assert.deepEqual(update.json(), { success: true })

      const after = await app.inject({ method: 'GET', url: '/_web/telemetry/enabled' })
      assert.equal(after.statusCode, 200)
      assert.deepEqual(after.json(), { enabled: false })
    } finally {
      await app.close()
    }
  })

  it('forwards typed events and properties to the shared analytics service', async () => {
    const tracked: Array<{ eventName: string; properties?: Record<string, unknown> }> = []
    const app = Fastify()
    registerTelemetryRoutes(app, {
      analyticsService: {
        getEnabled: () => true,
        setEnabled: () => {},
        trackDailyActive: async () => {},
        track: async (eventName, properties) => {
          tracked.push({ eventName, properties })
          return true
        },
      },
    })

    await app.ready()
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/_web/telemetry/track',
        payload: {
          eventName: 'feature_used',
          properties: { feature_id: 'insights', ignored: 'value' },
        },
      })

      assert.equal(response.statusCode, 200)
      assert.deepEqual(tracked, [
        {
          eventName: 'feature_used',
          properties: { feature_id: 'insights', ignored: 'value' },
        },
      ])
    } finally {
      await app.close()
    }
  })
})
