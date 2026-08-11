import assert from 'node:assert/strict'
import test from 'node:test'
import { InsightScopeController } from './insight-scope'
import { PluginLocaleHost } from './locale'
import {
  createStaticInsightPluginRuntime,
  installStaticInsightPluginUiServices,
  type StaticInsightPluginDescriptor,
} from './static-insight'
import { createUiServiceKey, UiServiceRegistry, type UiHostContext } from './ui-host'

const TEST_SERVICE = createUiServiceKey<{ value: string }>('test.static-insight-service')
const OTHER_SERVICE = createUiServiceKey<{ value: string }>('test.static-insight-other-service')
const BROKEN_SERVICE = createUiServiceKey<{ value: string }>('test.static-insight-broken-service')

const localeMessages = {
  'en-US': { 'test.page': 'Test page' },
  'zh-CN': { 'test.page': '测试页面' },
  'zh-TW': { 'test.page': '測試頁面' },
  'ja-JP': { 'test.page': 'テストページ' },
} as const

function createHost(services: UiServiceRegistry): UiHostContext & { locale: PluginLocaleHost } {
  const locale = new PluginLocaleHost({
    getLocale: () => 'en-US',
    subscribe: () => () => {},
    translate: (key) => key,
  })
  return {
    locale,
    insightScope: new InsightScopeController(),
    services,
  }
}

const descriptor: StaticInsightPluginDescriptor = {
  plugin: {
    id: 'test.static-insight',
    platforms: ['cli-web'],
    activate(context) {
      context.locale.register('plugins.test.static-insight', localeMessages)
      context.pages.register({
        id: 'test-page',
        path: 'test-page',
        routeName: 'insight-test-page',
        title: { namespace: 'plugins.test.static-insight', key: 'test.page' },
        icon: 'test-icon',
        view: { load: async () => ({}) },
      })
    },
  },
  installUiServices: async (services) => {
    services.register(TEST_SERVICE, { value: 'installed' })
  },
}

test('uses one static descriptor for plugin contributions and UI services', async () => {
  const services = new UiServiceRegistry()
  const uiHost = createHost(services)
  const runtime = createStaticInsightPluginRuntime('cli-web', uiHost, uiHost.locale, [descriptor])
  await installStaticInsightPluginUiServices([descriptor], runtime, services)

  assert.equal(runtime.getPage('test-page')?.id, 'test-page')
  assert.equal(services.get(TEST_SERVICE).value, 'installed')
  assert.equal(uiHost.locale.translate({ namespace: 'plugins.test.static-insight', key: 'test.page' }), 'Test page')

  runtime.dispose('test.static-insight')
  assert.equal(runtime.getPage('test-page'), undefined)
  assert.throws(() => services.get(TEST_SERVICE), /is unavailable/)
  assert.equal(uiHost.locale.translate({ namespace: 'plugins.test.static-insight', key: 'test.page' }), 'test.page')
})

test('removing a static descriptor removes both contributions and its service installer', async () => {
  const services = new UiServiceRegistry()
  const uiHost = createHost(services)
  const runtime = createStaticInsightPluginRuntime('cli-web', uiHost, uiHost.locale, [])
  await installStaticInsightPluginUiServices([], runtime, services)

  assert.equal(runtime.getPage('test-page'), undefined)
  assert.throws(() => services.get(TEST_SERVICE), /is unavailable/)
})

test('rolls back only the plugin whose UI service installation fails', async () => {
  const services = new UiServiceRegistry()
  const uiHost = createHost(services)
  const otherDescriptor: StaticInsightPluginDescriptor = {
    plugin: {
      id: 'test.other-insight',
      platforms: ['cli-web'],
      activate(context) {
        context.pages.register({
          id: 'other-page',
          path: 'other-page',
          routeName: 'insight-other-page',
          title: { namespace: 'plugins.test.other-insight', key: 'other.page' },
          icon: 'test-icon',
          view: { load: async () => ({}) },
        })
      },
    },
    installUiServices: async (registry) => {
      registry.register(OTHER_SERVICE, { value: 'other' })
    },
  }
  const brokenDescriptor: StaticInsightPluginDescriptor = {
    plugin: {
      id: 'test.broken-insight',
      platforms: ['cli-web'],
      activate(context) {
        context.pages.register({
          id: 'broken-page',
          path: 'broken-page',
          routeName: 'insight-broken-page',
          title: { namespace: 'plugins.test.broken-insight', key: 'broken.page' },
          icon: 'test-icon',
          view: { load: async () => ({}) },
        })
      },
    },
    installUiServices: async (registry) => {
      registry.register(BROKEN_SERVICE, { value: 'broken' })
      throw new Error('service installation failed')
    },
  }
  const descriptors = [otherDescriptor, brokenDescriptor]
  const runtime = createStaticInsightPluginRuntime('cli-web', uiHost, uiHost.locale, descriptors)

  await assert.rejects(
    () => installStaticInsightPluginUiServices(descriptors, runtime, services),
    /service installation failed/
  )

  assert.equal(runtime.isActive('test.other-insight'), true)
  assert.equal(runtime.getPage('other-page')?.id, 'other-page')
  assert.equal(services.get(OTHER_SERVICE).value, 'other')
  assert.equal(runtime.isActive('test.broken-insight'), false)
  assert.equal(runtime.getPage('broken-page'), undefined)
  assert.throws(() => services.get(BROKEN_SERVICE), /is unavailable/)
})
