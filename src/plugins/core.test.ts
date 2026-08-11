import assert from 'node:assert/strict'
import test from 'node:test'
import { ContributionRegistry, PluginHost, type ChatLabPlugin } from './core'

test('rolls back contributions when plugin activation fails', () => {
  const registry = new ContributionRegistry<{ id: string }>()
  const host = new PluginHost<{ register(id: string): void }>('cli-web', (pluginId, disposables) => ({
    register: (id) => {
      disposables.add(registry.register(pluginId, { id }))
    },
  }))

  assert.throws(
    () =>
      host.activate({
        id: 'broken',
        platforms: ['cli-web'],
        activate(context) {
          context.register('temporary')
          throw new Error('activation failed')
        },
      }),
    /activation failed/
  )
  assert.deepEqual(registry.list(), [])
  assert.equal(host.isActive('broken'), false)
})

test('rejects duplicate contributions', () => {
  const registry = new ContributionRegistry<{ id: string }>()
  const host = new PluginHost<{ register(id: string): void }>('cli-web', (pluginId, disposables) => ({
    register: (id) => {
      disposables.add(registry.register(pluginId, { id }))
    },
  }))
  const first: ChatLabPlugin<{ register(id: string): void }> = {
    id: 'first',
    platforms: ['cli-web'],
    activate: (context) => context.register('shared'),
  }

  host.activate(first)
  assert.throws(
    () =>
      host.activate({
        id: 'duplicate',
        platforms: ['cli-web'],
        activate: (context) => context.register('shared'),
      }),
    /already registered by plugin "first"/
  )
})

test('filters unsupported plugins and disposes active plugins in reverse order', () => {
  const events: string[] = []
  const host = new PluginHost<Record<string, never>>('cli-web', () => ({}))

  assert.equal(
    host.activate({
      id: 'web-wasm-only',
      platforms: ['web-wasm'],
      activate: () => {
        events.push('unexpected')
      },
    }),
    false
  )
  host.activate({
    id: 'first',
    platforms: ['cli-web'],
    activate: () => () => events.push('first'),
  })
  host.activate({
    id: 'second',
    platforms: ['cli-web'],
    activate: () => () => events.push('second'),
  })

  host.disposeAll()
  assert.deepEqual(events, ['second', 'first'])
})

test('adds late resources to the active plugin lifecycle', () => {
  const events: string[] = []
  const host = new PluginHost<Record<string, never>>('cli-web', () => ({}))
  host.activate({ id: 'late-resource', platforms: ['cli-web'], activate: () => () => events.push('activation') })

  host.addDisposer('late-resource', () => events.push('late'))
  host.dispose('late-resource')

  assert.deepEqual(events, ['late', 'activation'])
})
