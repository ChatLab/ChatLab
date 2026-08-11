import assert from 'node:assert/strict'
import test from 'node:test'
import type { LocaleType } from '@/i18n'
import { PluginLocaleHost, type PluginLocaleMessages } from './locale'

const messages = {
  'en-US': { greeting: 'Hello {name}' },
  'zh-CN': { greeting: '你好，{name}' },
  'zh-TW': { greeting: '你好，{name}' },
  'ja-JP': { greeting: 'こんにちは、{name}' },
} satisfies PluginLocaleMessages<'greeting'>

function createHost(initialLocale: LocaleType = 'en-US') {
  let locale = initialLocale
  let adapterListener: (() => void) | undefined
  const host = new PluginLocaleHost({
    getLocale: () => locale,
    subscribe: (listener) => {
      adapterListener = listener
      return () => {
        adapterListener = undefined
      }
    },
    translate: (key, params) => `${key}:${params?.name ?? ''}`,
  })
  return {
    host,
    setLocale(nextLocale: LocaleType) {
      locale = nextLocale
      adapterListener?.()
    },
  }
}

test('registers a plugin-owned namespace and reacts to locale changes', () => {
  const { host, setLocale } = createHost('en-US')
  const revisions: number[] = []
  host.subscribe(() => revisions.push(host.getSnapshot().revision))
  const dispose = host.register('example.plugin', 'plugins.example.plugin', messages)
  const t = host.bind<'greeting'>('plugins.example.plugin')

  assert.equal(t('greeting', { name: 'ChatLab' }), 'Hello ChatLab')
  setLocale('zh-CN')
  assert.equal(t('greeting', { name: 'ChatLab' }), '你好，ChatLab')

  dispose()
  assert.equal(t('greeting'), 'greeting')
  assert.deepEqual(revisions, [1, 2, 3])
})

test('only allows the owner namespace and one active registration', () => {
  const { host } = createHost()

  assert.throws(
    () => host.register('example.plugin', 'plugins.someone-else', messages),
    /must register locale namespace "plugins.example.plugin"/
  )
  host.register('example.plugin', 'plugins.example.plugin', messages)
  assert.throws(
    () => host.register('example.plugin', 'plugins.example.plugin', messages),
    /already registered by plugin "example.plugin"/
  )
})

test('rejects locale dictionaries whose key sets differ', () => {
  const { host } = createHost()
  const inconsistent = {
    'en-US': { greeting: 'Hello' },
    'zh-CN': {},
    'zh-TW': { greeting: '你好' },
    'ja-JP': { greeting: 'こんにちは' },
  } as unknown as PluginLocaleMessages<'greeting'>

  assert.throws(
    () => host.register('example.plugin', 'plugins.example.plugin', inconsistent),
    /must define the same keys for every supported locale \(zh-CN\)/
  )
})

test('delegates host and common translations without exposing another plugin namespace', () => {
  const { host } = createHost()
  host.register('example.plugin', 'plugins.example.plugin', messages)
  const t = host.bind<'greeting' | `common.${string}`>('plugins.example.plugin')

  assert.equal(host.translate('host.title', { name: 'ChatLab' }), 'host.title:ChatLab')
  assert.equal(t('common.retry'), 'common.retry:')
  assert.equal(host.bind('plugins.missing')('greeting'), 'greeting')
})
