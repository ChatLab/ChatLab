import assert from 'node:assert/strict'
import test from 'node:test'
import { BrowserPlatformAdapter } from './browser'

test('provides browser-local platform defaults without a CLI Web backend', async () => {
  const adapter = new BrowserPlatformAdapter('0.32.0')

  assert.equal(await adapter.getVersion(), '0.32.0')
  assert.equal(await adapter.getAnalyticsEnabled(), false)
  assert.deepEqual(await adapter.setAnalyticsEnabled(true), { success: false })
  assert.deepEqual(await adapter.showOpenDialog({ properties: ['openFile'] }), {
    canceled: true,
    filePaths: [],
  })
  assert.deepEqual(await adapter.checkUpdate(), {
    hasUpdate: false,
    currentVersion: '0.32.0',
  })
})
