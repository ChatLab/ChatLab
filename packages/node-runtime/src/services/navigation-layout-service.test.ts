import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { NAVIGATION_LAYOUT_SCHEMA_VERSION, type NavigationLayout } from '@openchatlab/shared-types'
import {
  createNavigationLayoutService,
  NavigationLayoutValidationError,
  normalizeNavigationLayout,
} from './navigation-layout-service'

const layout: NavigationLayout = {
  schemaVersion: NAVIGATION_LAYOUT_SCHEMA_VERSION,
  primary: [
    { kind: 'entry', entryId: 'host.home' },
    { kind: 'group', id: 'insight', title: '我的分析', children: ['insight.annual-summary', 'plugin.unavailable'] },
  ],
  hiddenEntryIds: ['insight.time-investment'],
}

test('navigation layout service preserves unknown entries and writes canonical JSON atomically', (t) => {
  const systemDir = fs.mkdtempSync(path.join(process.env.CHATLAB_TEST_TMPDIR ?? os.tmpdir(), 'chatlab-navigation-'))
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }))
  const service = createNavigationLayoutService(systemDir)

  assert.deepEqual(service.load(), { status: 'missing', layout: null })
  assert.deepEqual(service.save(layout), layout)
  assert.deepEqual(service.load(), { status: 'saved', layout })

  const settingsDir = path.join(systemDir, 'settings')
  assert.deepEqual(fs.readdirSync(settingsDir), ['navigation-layout.json'])
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(settingsDir, 'navigation-layout.json'), 'utf-8')), layout)
})

test('navigation layout service reports corrupt files without overwriting them and resets explicitly', (t) => {
  const systemDir = fs.mkdtempSync(path.join(process.env.CHATLAB_TEST_TMPDIR ?? os.tmpdir(), 'chatlab-navigation-'))
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }))
  const settingsDir = path.join(systemDir, 'settings')
  const filePath = path.join(settingsDir, 'navigation-layout.json')
  fs.mkdirSync(settingsDir, { recursive: true })
  fs.writeFileSync(filePath, '{ broken', 'utf-8')
  const service = createNavigationLayoutService(systemDir)

  assert.deepEqual(service.load(), { status: 'invalid', layout: null })
  assert.equal(fs.readFileSync(filePath, 'utf-8'), '{ broken')
  service.reset()
  assert.deepEqual(service.load(), { status: 'missing', layout: null })
})

test('navigation layout service shares last-writer-wins state across Desktop and CLI Web clients', (t) => {
  const systemDir = fs.mkdtempSync(path.join(process.env.CHATLAB_TEST_TMPDIR ?? os.tmpdir(), 'chatlab-navigation-'))
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }))
  const desktopClient = createNavigationLayoutService(systemDir)
  const cliWebClient = createNavigationLayoutService(systemDir)

  desktopClient.save(layout)
  assert.deepEqual(cliWebClient.load(), { status: 'saved', layout })

  const cliWebLayout: NavigationLayout = {
    schemaVersion: 1,
    primary: [{ kind: 'entry', entryId: 'insight.time-investment' }],
    hiddenEntryIds: ['insight.annual-summary'],
  }
  cliWebClient.save(cliWebLayout)
  assert.deepEqual(desktopClient.load(), { status: 'saved', layout: cliWebLayout })
})

test('navigation layout validation enforces two levels, stable unique entries, and hidden separation', () => {
  assert.throws(
    () => normalizeNavigationLayout({ ...layout, hiddenEntryIds: ['host.home'] }),
    NavigationLayoutValidationError
  )
  assert.throws(
    () =>
      normalizeNavigationLayout({
        ...layout,
        primary: [
          { kind: 'entry', entryId: 'same' },
          { kind: 'group', id: 'group', title: 'Group', children: ['same'] },
        ],
        hiddenEntryIds: [],
      }),
    /Duplicate navigation entry "same"/
  )
  assert.throws(
    () =>
      normalizeNavigationLayout({
        ...layout,
        primary: [{ kind: 'group', id: 'group', title: 'Group', children: [{ kind: 'entry', entryId: 'nested' }] }],
      }),
    /must be a non-empty string/
  )
})
