/**
 * Run: pnpm test -- src/routes/routes.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { createInsightPluginRuntime } from '@/plugins/insight'
import { getLegacyInsightPages, listInsightShellPages } from '@/plugins/insight-catalog'
import { InsightScopeController } from '@/plugins/insight-scope'
import { PluginLocaleHost } from '@/plugins/locale'
import { UiServiceRegistry, type UiHostContext } from '@/plugins/ui-host'
import { appRoutes, createAppRoutes } from './routes'

function findRoute(path: string) {
  return appRoutes.find((route) => route.path === path)
}

test('registers people contacts as the default people child route', () => {
  const peopleRoute = findRoute('/people')

  assert.ok(peopleRoute)
  assert.deepEqual(peopleRoute.redirect, { name: 'people-contacts' })
  assert.equal(
    peopleRoute.children?.some((route) => route.path === 'contacts' && route.name === 'people-contacts'),
    true
  )
})

test('registers people relationships child route', () => {
  const peopleRoute = findRoute('/people')

  assert.ok(peopleRoute)
  assert.ok(
    peopleRoute.children?.some((route) => route.path === 'relationships' && route.name === 'people-relationships')
  )
})

test('does not keep the old contacts page route', () => {
  assert.equal(findRoute('/contacts'), undefined)
})

test('registers annual summary as the default insight child route', () => {
  const insightRoute = findRoute('/insight')

  assert.ok(insightRoute)
  assert.deepEqual(insightRoute.redirect, { name: 'insight-annual-summary' })
  assert.equal(
    insightRoute.children?.some((route) => route.path === 'annual-summary' && route.name === 'insight-annual-summary'),
    true
  )
})

test('removes the annual summary route and changes the default when its plugin is absent', () => {
  const localeHost = new PluginLocaleHost({
    getLocale: () => 'en-US',
    subscribe: () => () => {},
    translate: (key) => key,
  })
  const uiHost: UiHostContext = {
    locale: localeHost,
    insightScope: new InsightScopeController(),
    services: new UiServiceRegistry(),
  }
  const runtimeWithoutPlugins = createInsightPluginRuntime(
    'cli-web',
    uiHost,
    localeHost,
    [],
    getLegacyInsightPages('cli-web')
  )
  const routesWithoutPlugins = createAppRoutes(runtimeWithoutPlugins)
  const insightRoute = routesWithoutPlugins.find((route) => route.path === '/insight')

  assert.ok(insightRoute)
  assert.deepEqual(
    listInsightShellPages(runtimeWithoutPlugins).map((page) => page.id),
    ['time-investment', 'relationship-changes']
  )
  assert.deepEqual(insightRoute.redirect, { name: 'insight-time-investment' })
  assert.equal(
    insightRoute.children?.some((route) => route.name === 'insight-annual-summary'),
    false
  )
})

test('reserves time investment and relationship change insight routes', () => {
  const insightRoute = findRoute('/insight')

  assert.ok(insightRoute)
  assert.equal(
    insightRoute.children?.some(
      (route) => route.path === 'time-investment' && route.name === 'insight-time-investment'
    ),
    true
  )
  assert.equal(
    insightRoute.children?.some(
      (route) => route.path === 'relationship-changes' && route.name === 'insight-relationship-changes'
    ),
    true
  )
})
