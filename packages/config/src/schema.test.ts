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

test('accepts memory as a session landing tab', () => {
  const config = configSchema.parse({
    ui: {
      default_session_tab: 'overview',
      default_session_tab_override: 'memory',
    },
  })

  assert.equal(config.ui.default_session_tab, 'memory')
})

test('accepts canonical memory input and its parsed output', () => {
  const config = configSchema.parse({ ui: { default_session_tab: 'memory' } })

  assert.equal(config.ui.default_session_tab, 'memory')
  assert.equal(configSchema.parse(config).ui.default_session_tab, 'memory')
})

test('prefers a later legacy session tab change over the memory override', () => {
  const config = configSchema.parse({
    ui: {
      default_session_tab: 'ai-chat',
      default_session_tab_override: 'memory',
    },
  })

  assert.equal(config.ui.default_session_tab, 'ai-chat')
})

test('does not reinterpret a historical overview preference as memory', () => {
  const config = configSchema.parse({ ui: { default_session_tab: 'overview' } })

  assert.equal(config.ui.default_session_tab, 'insights')
})

test('rejects unknown session landing tabs', () => {
  assert.throws(() => configSchema.parse({ ui: { default_session_tab: 'unknown' } }))
  assert.throws(() => configSchema.parse({ ui: { default_session_tab_override: 'unknown' } }))
})

test('defaults Windows close behavior to running in the background', () => {
  const config = configSchema.parse({})

  assert.equal(config.desktop.close_behavior, 'background')
})

test('accepts supported Windows close behaviors and rejects invalid values', () => {
  for (const closeBehavior of ['background', 'quit']) {
    assert.equal(
      configSchema.parse({ desktop: { close_behavior: closeBehavior } }).desktop.close_behavior,
      closeBehavior
    )
  }

  assert.throws(() => configSchema.parse({ desktop: { close_behavior: 'ask' } }))
  assert.throws(() => configSchema.parse({ desktop: { close_behavior: 'hide-forever' } }))
})
