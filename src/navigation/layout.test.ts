import assert from 'node:assert/strict'
import test from 'node:test'
import { NAVIGATION_LAYOUT_SCHEMA_VERSION, type NavigationLayout } from '@openchatlab/shared-types'
import { createInsightPluginRuntime, type InsightPlugin } from '@/plugins/insight'
import { InsightScopeController } from '@/plugins/insight-scope'
import { PluginLocaleHost } from '@/plugins/locale'
import { UiServiceRegistry, type UiHostContext } from '@/plugins/ui-host'
import { createDefaultNavigationLayout, NavigationLayoutController, resolveNavigationLayout } from './layout'

function createRuntime() {
  const locale = new PluginLocaleHost({
    getLocale: () => 'en-US',
    subscribe: () => () => {},
    translate: (key) => key,
  })
  const ui: UiHostContext = { locale, insightScope: new InsightScopeController(), services: new UiServiceRegistry() }
  const plugin = (id: string, pageId: string, order: number): InsightPlugin => ({
    id,
    platforms: ['cli-web'],
    activate(context) {
      context.locale.register(`plugins.${id}`, {
        'en-US': { title: pageId },
        'zh-CN': { title: pageId },
        'zh-TW': { title: pageId },
        'ja-JP': { title: pageId },
      })
      context.pages.register({
        id: pageId,
        path: pageId,
        routeName: `insight-${pageId}`,
        title: { namespace: `plugins.${id}`, key: 'title' },
        icon: `icon-${pageId}`,
        view: { load: async () => ({}) },
      })
      context.navigation.register({ id: `entry.${pageId}`, pageId, order })
    },
  })
  return createInsightPluginRuntime('cli-web', ui, locale, [
    plugin('first', 'first', 10),
    plugin('second', 'second', 20),
  ])
}

test('default layout keeps the current single Insight primary group and contribution order', () => {
  const layout = createDefaultNavigationLayout(createRuntime())

  assert.deepEqual(layout, {
    schemaVersion: NAVIGATION_LAYOUT_SCHEMA_VERSION,
    primary: [
      {
        kind: 'group',
        id: 'host.insight',
        children: ['entry.first', 'entry.second', 'insight.relationship-changes'],
      },
    ],
    hiddenEntryIds: [],
  })
})

test('saved layout promotes entries, preserves custom groups, hides entries, and omits unavailable IDs', () => {
  const runtime = createRuntime()
  const layout: NavigationLayout = {
    schemaVersion: NAVIGATION_LAYOUT_SCHEMA_VERSION,
    primary: [
      { kind: 'entry', entryId: 'entry.second' },
      { kind: 'group', id: 'custom', title: 'My group', children: ['plugin.unavailable', 'entry.first'] },
    ],
    hiddenEntryIds: ['insight.relationship-changes'],
  }

  assert.deepEqual(
    resolveNavigationLayout(runtime, layout).primary.map((item) =>
      item.kind === 'entry'
        ? { kind: item.kind, entryId: item.entryId }
        : { kind: item.kind, id: item.id, title: item.title, entries: item.entries.map(({ entryId }) => entryId) }
    ),
    [
      { kind: 'entry', entryId: 'entry.second' },
      { kind: 'group', id: 'custom', title: 'My group', entries: ['entry.first'] },
    ]
  )
  assert.deepEqual(layout.primary[1], {
    kind: 'group',
    id: 'custom',
    title: 'My group',
    children: ['plugin.unavailable', 'entry.first'],
  })
})

test('new plugin entries are appended to the localized default group without mutating saved layout', () => {
  const runtime = createRuntime()
  const layout: NavigationLayout = {
    schemaVersion: 1,
    primary: [{ kind: 'entry', entryId: 'entry.first' }],
    hiddenEntryIds: [],
  }
  const resolved = resolveNavigationLayout(runtime, layout)

  assert.deepEqual(
    resolved.primary.map((item) =>
      item.kind === 'entry' ? item.entryId : { id: item.id, entries: item.entries.map(({ entryId }) => entryId) }
    ),
    ['entry.first', { id: 'host.insight', entries: ['entry.second', 'insight.relationship-changes'] }]
  )
  assert.deepEqual(layout.primary, [{ kind: 'entry', entryId: 'entry.first' }])
})

test('controller falls back to defaults for missing or invalid saved layouts', () => {
  const controller = new NavigationLayoutController(createRuntime())
  let notifications = 0
  controller.subscribe(() => notifications++)

  controller.applyLoadResult({ status: 'invalid', layout: null })

  assert.equal(controller.getSnapshot().source, 'invalid')
  assert.equal(controller.getResolvedLayout().primary.length, 1)
  assert.equal(notifications, 1)
})
