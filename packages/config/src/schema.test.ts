import assert from 'node:assert/strict'
import test from 'node:test'
import { configSchema } from './schema'

test('defaults the session landing tab to insights', () => {
  const config = configSchema.parse({})

  assert.equal(config.ui.default_session_tab, 'insights')
})

test('normalizes the released overview preference to insights', () => {
  const config = configSchema.parse({ ui: { default_session_tab: 'overview' } })

  assert.equal(config.ui.default_session_tab, 'insights')
})

test('rejects unknown session landing tabs', () => {
  assert.throws(() => configSchema.parse({ ui: { default_session_tab: 'unknown' } }))
})
