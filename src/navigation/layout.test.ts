import assert from 'node:assert/strict'
import test from 'node:test'
import { NAVIGATION_LAYOUT_SCHEMA_VERSION, type NavigationLayout } from '@openchatlab/shared-types'
import { createInsightPluginRuntime, type InsightPlugin } from '@/plugins/insight'
import { InsightScopeController } from '@/plugins/insight-scope'
import { PluginLocaleHost } from '@/plugins/locale'
import { UiServiceRegistry, type UiHostContext } from '@/plugins/ui-host'
import {
  createDefaultNavigationLayout,
  createEditableNavigationLayout,
  moveGroupedNavigationEntry,
  movePrimaryNavigationItem,
  NavigationLayoutController,
  canWriteNavigationLayout,
  placeNavigationEntry,
  resolveNavigationLayout,
} from './layout'

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

test('controller preserves load failure provenance and blocks layout writes', () => {
  const controller = new NavigationLayoutController(createRuntime())

  controller.applyLoadFailure()

  assert.equal(controller.getSnapshot().source, 'failed')
  assert.equal(controller.getResolvedLayout().primary.length, 1)
  assert.equal(canWriteNavigationLayout(controller.getSnapshot().source), false)
  assert.equal(canWriteNavigationLayout('invalid'), true)
  assert.equal(canWriteNavigationLayout('missing'), true)
  assert.equal(canWriteNavigationLayout('saved'), true)
  assert.equal(canWriteNavigationLayout('default'), true)
})

test('editable layout materializes newly available entries while preserving unknown IDs', () => {
  const layout: NavigationLayout = {
    schemaVersion: 1,
    primary: [
      { kind: 'entry', entryId: 'entry.first' },
      { kind: 'group', id: 'custom', title: 'Custom', children: ['plugin.unavailable'] },
    ],
    hiddenEntryIds: [],
  }

  assert.deepEqual(createEditableNavigationLayout(createRuntime(), layout), {
    schemaVersion: 1,
    primary: [
      { kind: 'entry', entryId: 'entry.first' },
      { kind: 'group', id: 'custom', title: 'Custom', children: ['plugin.unavailable'] },
      {
        kind: 'group',
        id: 'host.insight',
        children: ['entry.second', 'insight.relationship-changes'],
      },
    ],
    hiddenEntryIds: [],
  })
  assert.equal(layout.primary.length, 2)
})

test('navigation editing moves entries between primary, groups, and hidden without losing other IDs', () => {
  const initial: NavigationLayout = {
    schemaVersion: 1,
    primary: [
      { kind: 'entry', entryId: 'entry.first' },
      {
        kind: 'group',
        id: 'host.insight',
        children: ['entry.second', 'plugin.unavailable', 'insight.relationship-changes'],
      },
    ],
    hiddenEntryIds: [],
  }

  const promoted = placeNavigationEntry(initial, 'entry.second', { kind: 'primary' })
  const hidden = placeNavigationEntry(promoted, 'entry.first', { kind: 'hidden' })
  const restored = placeNavigationEntry(hidden, 'entry.first', { kind: 'group', groupId: 'host.insight' })

  assert.deepEqual(restored, {
    schemaVersion: 1,
    primary: [
      {
        kind: 'group',
        id: 'host.insight',
        children: ['plugin.unavailable', 'insight.relationship-changes', 'entry.first'],
      },
      { kind: 'entry', entryId: 'entry.second' },
    ],
    hiddenEntryIds: [],
  })
  assert.deepEqual(initial.primary[1], {
    kind: 'group',
    id: 'host.insight',
    children: ['entry.second', 'plugin.unavailable', 'insight.relationship-changes'],
  })
})

test('navigation editing reorders primary items and grouped entries within two levels', () => {
  const layout: NavigationLayout = {
    schemaVersion: 1,
    primary: [
      { kind: 'entry', entryId: 'entry.first' },
      { kind: 'group', id: 'host.insight', children: ['entry.second', 'insight.relationship-changes'] },
    ],
    hiddenEntryIds: [],
  }

  const primaryMoved = movePrimaryNavigationItem(layout, 1, -1)
  const childMoved = moveGroupedNavigationEntry(primaryMoved, 'host.insight', 1, -1)

  assert.deepEqual(
    childMoved.primary.map((item) => (item.kind === 'entry' ? item.entryId : item.children)),
    [['insight.relationship-changes', 'entry.second'], 'entry.first']
  )
})

test('restoring a hidden entry recreates the default group when the saved layout has no groups', () => {
  const layout: NavigationLayout = {
    schemaVersion: 1,
    primary: [],
    hiddenEntryIds: ['entry.first'],
  }

  assert.deepEqual(placeNavigationEntry(layout, 'entry.first', { kind: 'group', groupId: 'host.insight' }), {
    schemaVersion: 1,
    primary: [{ kind: 'group', id: 'host.insight', children: ['entry.first'] }],
    hiddenEntryIds: [],
  })
})
