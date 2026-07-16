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
})
