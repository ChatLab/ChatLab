import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { RuntimeLogEvent, WebRuntimeRpcClientOptions } from '@openchatlab/web-runtime'
import { BrowserRuntimeAdapter } from './browser'
import { BrowserImportAdapter } from '../import/browser'
import { BrowserPlatformAdapter } from '../platform/browser'
import { BrowserPreferencesAdapter } from '../preferences/browser'
import { registerWebWasmAdapters } from './register'

describe('registerWebWasmAdapters', () => {
  it('registers the browser runtime adapter and forwards Worker logs', () => {
    const registrations = new Map<string, unknown>()
    const logs: RuntimeLogEvent[] = []
    let clientOptions: WebRuntimeRpcClientOptions | undefined
    const client = {
      request: () => Promise.reject(new Error('not used')),
      dispose: () => undefined,
    }

    registerWebWasmAdapters({
      register: (key, adapter) => registrations.set(key, adapter),
      createClient: (options) => {
        clientOptions = options
        return client
      },
      reportLog: (event) => logs.push(event),
    })

    assert.deepEqual([...registrations.keys()], ['browser-runtime', 'import', 'data', 'platform', 'preferences'])
    assert.ok(registrations.get('browser-runtime') instanceof BrowserRuntimeAdapter)
    assert.ok(registrations.get('import') instanceof BrowserImportAdapter)
    assert.ok(registrations.get('platform') instanceof BrowserPlatformAdapter)
    assert.ok(registrations.get('preferences') instanceof BrowserPreferencesAdapter)

    const event: RuntimeLogEvent = {
      level: 'info',
      scope: 'web-runtime',
      message: 'Worker initialized',
    }
    clientOptions?.onLog?.(event)
    assert.deepEqual(logs, [event])
  })
})
