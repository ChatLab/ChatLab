import assert from 'node:assert/strict'
import test from 'node:test'
import { annualSummaryBuiltin } from './builtin/annual-summary'
import { timeInvestmentBuiltin } from './builtin/time-investment'
import { getLegacyInsightPages, listInsightShellPages } from './insight-catalog'
import { createInsightPluginRuntime, type InsightPlugin } from './insight'
import { InsightScopeController } from './insight-scope'
import { PluginLocaleHost } from './locale'
import { UiServiceRegistry, type UiHostContext } from './ui-host'

const annualSummaryPlugin = annualSummaryBuiltin.plugin
const timeInvestmentPlugin = timeInvestmentBuiltin.plugin

function createTestHost(): { localeHost: PluginLocaleHost; uiHost: UiHostContext } {
  const localeHost = new PluginLocaleHost({
    getLocale: () => 'en-US',
    subscribe: () => () => {},
    translate: (key) => key,
  })
  return {
    localeHost,
    uiHost: {
      locale: localeHost,
      insightScope: new InsightScopeController(),
      services: new UiServiceRegistry(),
    },
  }
}

test('registers annual summary as a removable Desktop and CLI Web contribution', () => {
  const { uiHost, localeHost } = createTestHost()
  const runtime = createInsightPluginRuntime('cli-web', uiHost, localeHost, [annualSummaryPlugin])

  assert.equal(runtime.isActive(annualSummaryPlugin.id), true)
  assert.equal(runtime.getDefaultPage()?.id, 'annual-summary')
  assert.deepEqual(runtime.getPage('annual-summary')?.filters?.time, {
    allowedModes: ['recent', 'year'],
    allowedRecentDays: [365],
    defaultMode: 'year',
  })
  assert.deepEqual(
    runtime.listNavigation().map(({ page }) => page.id),
    ['annual-summary']
  )
  const title = runtime.getPage('annual-summary')!.title
  assert.equal(uiHost.locale.translate(title), 'About Me')

  runtime.dispose(annualSummaryPlugin.id)
  assert.equal(runtime.getPage('annual-summary'), undefined)
  assert.deepEqual(runtime.listNavigation(), [])
  assert.equal(uiHost.locale.translate(title), 'title')
})

test('keeps the annual summary plugin out of Web WASM', () => {
  const { uiHost, localeHost } = createTestHost()
  const runtime = createInsightPluginRuntime('web-wasm', uiHost, localeHost, [
    annualSummaryPlugin,
    timeInvestmentPlugin,
  ])

  assert.equal(runtime.isActive(annualSummaryPlugin.id), false)
  assert.equal(runtime.isActive(timeInvestmentPlugin.id), true)
  assert.deepEqual(
    listInsightShellPages(runtime).map((page) => page.id),
    ['time-investment']
  )
})

test('registers time investment on every platform and removes all of its contributions', () => {
  for (const platform of ['electron', 'cli-web', 'web-wasm'] as const) {
    const { uiHost, localeHost } = createTestHost()
    const runtime = createInsightPluginRuntime(platform, uiHost, localeHost, [timeInvestmentPlugin])
    const title = runtime.getPage('time-investment')!.title

    assert.equal(runtime.isActive(timeInvestmentPlugin.id), true)
    assert.equal(uiHost.locale.translate(title), 'Time Investment')
    assert.deepEqual(
      runtime.listNavigation().map(({ page }) => page.id),
      ['time-investment']
    )

    runtime.dispose(timeInvestmentPlugin.id)
    assert.equal(runtime.getPage('time-investment'), undefined)
    assert.equal(uiHost.locale.translate(title), 'title')
  }
})

test('combines plugin and legacy Insight pages by navigation order', () => {
  const { uiHost, localeHost } = createTestHost()
  const runtime = createInsightPluginRuntime('electron', uiHost, localeHost, [
    annualSummaryPlugin,
    timeInvestmentPlugin,
  ])

  assert.deepEqual(
    listInsightShellPages(runtime).map((page) => page.id),
    ['annual-summary', 'time-investment', 'relationship-changes']
  )
})

test('rolls back a plugin whose navigation targets an unknown page', () => {
  const { uiHost, localeHost } = createTestHost()
  const brokenPlugin: InsightPlugin = {
    id: 'broken-insight',
    platforms: ['cli-web'],
    activate(context) {
      assert.equal(context.ui, uiHost)
      context.locale.register('plugins.broken-insight', {
        'en-US': { title: 'Broken' },
        'zh-CN': { title: '损坏' },
        'zh-TW': { title: '損壞' },
        'ja-JP': { title: '破損' },
      })
      context.navigation.register({ id: 'broken-entry', pageId: 'missing-page', order: 1 })
    },
  }
  const runtime = createInsightPluginRuntime('cli-web', uiHost, localeHost)

  assert.throws(() => runtime.activate(brokenPlugin), /targets unknown page "missing-page"/)
  assert.equal(runtime.isActive(brokenPlugin.id), false)
  assert.deepEqual(runtime.listNavigation(), [])
  assert.equal(localeHost.bind('plugins.broken-insight')('title'), 'title')
})

test('normalizes time filter declarations and rejects invalid defaults', () => {
  const { uiHost, localeHost } = createTestHost()
  const runtime = createInsightPluginRuntime('cli-web', uiHost, localeHost)
  runtime.activate({
    id: 'normalized-filter',
    platforms: ['cli-web'],
    activate(context) {
      context.pages.register({
        id: 'normalized',
        path: 'normalized',
        routeName: 'insight-normalized',
        title: { namespace: 'plugins.normalized-filter', key: 'normalized.title' },
        icon: 'normalized-icon',
        filters: {
          time: {
            allowedModes: ['year', 'year', 'recent'],
            allowedRecentDays: [365, 365],
            defaultMode: 'year',
          },
        },
        view: { load: async () => ({}) },
      })
    },
  })
  assert.deepEqual(runtime.getPage('normalized')?.filters?.time, {
    allowedModes: ['year', 'recent'],
    allowedRecentDays: [365],
    defaultMode: 'year',
  })

  assert.throws(
    () =>
      runtime.activate({
        id: 'invalid-filter',
        platforms: ['cli-web'],
        activate(context) {
          context.pages.register({
            id: 'invalid',
            path: 'invalid',
            routeName: 'insight-invalid',
            title: { namespace: 'plugins.invalid-filter', key: 'invalid.title' },
            icon: 'invalid-icon',
            filters: { time: { allowedModes: ['recent'], defaultMode: 'year' } },
            view: { load: async () => ({}) },
          })
        },
      }),
    /default time mode that is not allowed/
  )
  assert.equal(runtime.isActive('invalid-filter'), false)
})

test('rejects plugin pages that conflict with host-owned legacy pages', () => {
  const { uiHost, localeHost } = createTestHost()
  const runtime = createInsightPluginRuntime('cli-web', uiHost, localeHost, [], getLegacyInsightPages('cli-web'))

  assert.throws(
    () =>
      runtime.activate({
        id: 'conflicting-page',
        platforms: ['cli-web'],
        activate(context) {
          context.pages.register({
            id: 'relationship-changes',
            path: 'another-path',
            routeName: 'another-route',
            title: { namespace: 'plugins.conflicting-page', key: 'another.title' },
            icon: 'another-icon',
            view: { load: async () => ({}) },
          })
        },
      }),
    /conflicts with a host page/
  )
  assert.equal(runtime.isActive('conflicting-page'), false)
})
