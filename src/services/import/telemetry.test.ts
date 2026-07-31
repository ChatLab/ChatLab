import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { AnalyticsEventName } from '@openchatlab/shared-types'
import type { ImportAdapter, ImportResult } from './types'
import { TelemetryImportAdapter } from './telemetry'

function createDelegate(
  importResult: ImportResult = { success: true, sessionId: 'session-1', platform: 'weixin' }
): ImportAdapter {
  return {
    importFile: async () => importResult,
    detectFormat: async () => ({
      id: 'chatlab',
      name: 'ChatLab JSON',
      platform: 'qq',
      extensions: ['json'],
    }),
    scanMultiChatFile: async () => [],
    prepareImportSource: async () => ({ success: false }),
    importPreparedChat: async () => importResult,
    releaseImportSource: async () => {},
    getSupportedFormats: async () => [],
    importDemo: async () => ({ success: true }),
    analyzeIncrementalImport: async () => ({ newMessageCount: 0, duplicateCount: 0, totalInFile: 0, platform: 'qq' }),
    incrementalImport: async () => ({ success: true, newMessageCount: 0 }),
    importDirectory: async () => importResult,
  }
}

describe('TelemetryImportAdapter', () => {
  it('preserves and tracks the delegate batch capability', async () => {
    const events: Array<{ name: AnalyticsEventName; properties?: Record<string, unknown> }> = []
    const progressEvents: unknown[] = []
    const delegate = createDelegate()
    let cancelCalls = 0
    let receivedOptions: unknown

    delegate.importBatch = async (items, options, onProgress) => {
      receivedOptions = options
      onProgress?.({ index: 0, event: 'start' })
      return [
        {
          id: items[0].id,
          status: 'success',
          result: { success: true, sessionId: 'session-1', platform: 'qq', importMode: 'created' },
        },
        { id: items[1].id, status: 'failed', error: 'Parser failed at /Users/alice/private.json' },
      ]
    }
    delegate.cancelActiveImport = () => {
      cancelCalls++
    }

    const platform = {
      trackAnalyticsEvent: async (name: AnalyticsEventName, properties?: Record<string, unknown>) => {
        events.push({ name, properties })
      },
    }
    const adapter = new TelemetryImportAdapter(delegate, platform) as ImportAdapter
    const adapterWithoutBatch = new TelemetryImportAdapter(createDelegate(), platform) as ImportAdapter
    const items = [
      { id: 'first', file: new File(['{}'], 'first-private.json') },
      { id: 'second', file: new File(['{}'], 'second-private.json') },
    ]

    assert.equal(adapterWithoutBatch.importBatch, undefined)
    assert.equal(typeof adapter.importBatch, 'function')
    const results = await adapter.importBatch!(items, { formatId: 'whatsapp-native-txt' }, (event) =>
      progressEvents.push(event)
    )
    adapter.cancelActiveImport?.()
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.deepEqual(receivedOptions, { formatId: 'whatsapp-native-txt' })
    assert.deepEqual(progressEvents, [{ index: 0, event: 'start' }])
    assert.deepEqual(
      results.map((result) => ({ id: result.id, status: result.status })),
      [
        { id: 'first', status: 'success' },
        { id: 'second', status: 'failed' },
      ]
    )
    assert.equal(cancelCalls, 1)
    assert.deepEqual(
      events.map((event) => ({
        name: event.name,
        platform: event.properties?.chat_platform,
        failureReason: event.properties?.failure_reason,
      })),
      [
        { name: 'chat_import_started', platform: 'whatsapp', failureReason: undefined },
        { name: 'chat_import_completed', platform: 'qq', failureReason: undefined },
        { name: 'chat_import_started', platform: 'whatsapp', failureReason: undefined },
        { name: 'chat_import_failed', platform: 'whatsapp', failureReason: 'parse' },
      ]
    )
    assert.equal(typeof events[1].properties?.duration_ms, 'number')
    assert.equal(JSON.stringify(events).includes('private.json'), false)
    assert.equal(JSON.stringify(events).includes('/Users/alice'), false)
  })

  it('tracks the remembered format and the actual imported platform without file details', async () => {
    const events: Array<{ name: AnalyticsEventName; properties?: Record<string, unknown> }> = []
    const file = new File(['{}'], 'private-chat.json')
    const adapter = new TelemetryImportAdapter(createDelegate(), {
      trackAnalyticsEvent: async (name, properties) => {
        events.push({ name, properties })
      },
    })

    await adapter.detectFormat(file)
    await adapter.importFile(file)
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(events.length, 2)
    assert.deepEqual(events[0], {
      name: 'chat_import_started',
      properties: { chat_platform: 'qq' },
    })
    assert.equal(events[1].name, 'chat_import_completed')
    assert.equal(events[1].properties?.chat_platform, 'weixin')
    assert.equal(typeof events[1].properties?.duration_ms, 'number')
    assert.equal(JSON.stringify(events).includes('private-chat.json'), false)
  })

  it('only sends a whitelisted failure category', async () => {
    const events: Array<{ name: AnalyticsEventName; properties?: Record<string, unknown> }> = []
    const adapter = new TelemetryImportAdapter(
      createDelegate({ success: false, error: 'Parser failed at /Users/alice/private.json' }),
      {
        trackAnalyticsEvent: async (name, properties) => {
          events.push({ name, properties })
        },
      }
    )

    await adapter.importFile(new File(['{}'], 'private.json'), { formatId: 'whatsapp-native-txt' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.deepEqual(events.at(-1), {
      name: 'chat_import_failed',
      properties: { chat_platform: 'whatsapp', failure_reason: 'parse' },
    })
    assert.equal(JSON.stringify(events).includes('/Users/alice'), false)
  })

  it('classifies a rejected import request as a network failure', async () => {
    const events: Array<{ name: AnalyticsEventName; properties?: Record<string, unknown> }> = []
    const delegate = createDelegate()
    delegate.importFile = async () => {
      throw new TypeError('Failed to fetch')
    }
    const adapter = new TelemetryImportAdapter(delegate, {
      trackAnalyticsEvent: async (name, properties) => {
        events.push({ name, properties })
      },
    })

    await assert.rejects(() => adapter.importFile(new File(['{}'], 'private.json')), /Failed to fetch/)
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.deepEqual(events.at(-1), {
      name: 'chat_import_failed',
      properties: { chat_platform: 'unknown', failure_reason: 'network' },
    })
  })

  it('tracks the detected platform returned by a failed created import', async () => {
    const events: Array<{ name: AnalyticsEventName; properties?: Record<string, unknown> }> = []
    const adapter = new TelemetryImportAdapter(
      createDelegate({ success: false, platform: 'line', error: 'database unavailable' }),
      {
        trackAnalyticsEvent: async (name, properties) => {
          events.push({ name, properties })
        },
      }
    )

    await adapter.importFile(new File(['{}'], 'private.json'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.deepEqual(events.at(-1), {
      name: 'chat_import_failed',
      properties: { chat_platform: 'line', failure_reason: 'write' },
    })
  })

  it('tracks the detected platform returned by a failed directory import', async () => {
    const events: Array<{ name: AnalyticsEventName; properties?: Record<string, unknown> }> = []
    const adapter = new TelemetryImportAdapter(
      createDelegate({ success: false, platform: 'line', error: 'database unavailable' }),
      {
        trackAnalyticsEvent: async (name, properties) => {
          events.push({ name, properties })
        },
      }
    )

    await adapter.importDirectory([new File(['{}'], 'chat.json')])
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.deepEqual(events.at(-1), {
      name: 'chat_import_failed',
      properties: { chat_platform: 'line', failure_reason: 'write' },
    })
  })

  it('tracks incremental imports without exposing the session or file name', async () => {
    const events: Array<{ name: AnalyticsEventName; properties?: Record<string, unknown> }> = []
    const file = new File(['{}'], 'incremental-private.json')
    const adapter = new TelemetryImportAdapter(createDelegate(), {
      trackAnalyticsEvent: async (name, properties) => {
        events.push({ name, properties })
      },
    })

    await adapter.analyzeIncrementalImport('private-session-id', file)
    await adapter.incrementalImport('private-session-id', file)
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.deepEqual(events, [{ name: 'incremental_import_used', properties: undefined }])
    assert.equal(JSON.stringify(events).includes('private-session-id'), false)
    assert.equal(JSON.stringify(events).includes('incremental-private.json'), false)
  })

  it('tracks automatic incremental imports as a platform-independent usage event', async () => {
    const events: Array<{ name: AnalyticsEventName; properties?: Record<string, unknown> }> = []
    const adapter = new TelemetryImportAdapter(
      createDelegate({
        success: true,
        sessionId: 'existing-session',
        importMode: 'incremental',
        platform: 'private-platform-value',
      }),
      {
        trackAnalyticsEvent: async (name, properties) => {
          events.push({ name, properties })
        },
      }
    )

    await adapter.importFile(new File(['{}'], 'incremental.json'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.deepEqual(events, [{ name: 'incremental_import_used', properties: undefined }])
  })

  it('counts failed automatic incremental attempts without a platform failure event', async () => {
    const events: Array<{ name: AnalyticsEventName; properties?: Record<string, unknown> }> = []
    const adapter = new TelemetryImportAdapter(
      createDelegate({
        success: false,
        sessionId: 'existing-session',
        importMode: 'incremental',
        error: 'write failed',
      }),
      {
        trackAnalyticsEvent: async (name, properties) => {
          events.push({ name, properties })
        },
      }
    )

    await adapter.importFile(new File(['{}'], 'incremental.json'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.deepEqual(events, [{ name: 'incremental_import_used', properties: undefined }])
  })
})
