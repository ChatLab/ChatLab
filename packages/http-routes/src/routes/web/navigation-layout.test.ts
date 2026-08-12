import assert from 'node:assert/strict'
import test from 'node:test'
import Fastify from 'fastify'
import type { PathProvider } from '@openchatlab/core'
import {
  NAVIGATION_LAYOUT_SCHEMA_VERSION,
  type NavigationLayout,
  type NavigationLayoutLoadResult,
} from '@openchatlab/shared-types'
import { NavigationLayoutValidationError, type NavigationLayoutService } from '@openchatlab/node-runtime'
import { registerNavigationLayoutRoutes } from './navigation-layout'

const layout: NavigationLayout = {
  schemaVersion: NAVIGATION_LAYOUT_SCHEMA_VERSION,
  primary: [{ kind: 'group', id: 'insight', title: 'Insight', children: ['insight.time-investment'] }],
  hiddenEntryIds: ['plugin.unavailable'],
}

class FakeNavigationLayoutService implements NavigationLayoutService {
  current: NavigationLayoutLoadResult = { status: 'missing', layout: null }
  resetCalls = 0

  load(): NavigationLayoutLoadResult {
    return this.current
  }

  save(input: unknown): NavigationLayout {
    if (!input || typeof input !== 'object' || (input as { schemaVersion?: unknown }).schemaVersion !== 1) {
      throw new NavigationLayoutValidationError('invalid')
    }
    this.current = { status: 'saved', layout: input as NavigationLayout }
    return input as NavigationLayout
  }

  reset(): void {
    this.resetCalls++
    this.current = { status: 'missing', layout: null }
  }
}

test('navigation layout routes load, save, reject invalid payloads, and reset', async (t) => {
  const service = new FakeNavigationLayoutService()
  const app = Fastify()
  t.after(() => app.close())
  registerNavigationLayoutRoutes(app, {
    pathProvider: {} as PathProvider,
    navigationLayoutService: service,
  })
  await app.ready()

  assert.deepEqual((await app.inject({ method: 'GET', url: '/_web/navigation-layout' })).json(), {
    status: 'missing',
    layout: null,
  })

  const saved = await app.inject({ method: 'PUT', url: '/_web/navigation-layout', payload: layout })
  assert.equal(saved.statusCode, 200)
  assert.deepEqual(saved.json(), { status: 'saved', layout })

  const invalid = await app.inject({ method: 'PUT', url: '/_web/navigation-layout', payload: { schemaVersion: 2 } })
  assert.equal(invalid.statusCode, 400)
  assert.deepEqual(invalid.json(), { error: 'INVALID_NAVIGATION_LAYOUT' })

  const reset = await app.inject({ method: 'DELETE', url: '/_web/navigation-layout' })
  assert.equal(reset.statusCode, 200)
  assert.deepEqual(reset.json(), { status: 'missing', layout: null })
  assert.equal(service.resetCalls, 1)
})
