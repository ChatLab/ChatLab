import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AnalyticsService, type AnalyticsServiceOptions } from './analytics'

const UMAMI_ENDPOINT = 'https://telemetry.example.com/api/send'
const UMAMI_WEBSITE_ID = 'website-test-id'

function createTempSystemDir(): string {
  return mkdtempSync(join(tmpdir(), 'chatlab-analytics-'))
}

function createOptions(overrides: Partial<AnalyticsServiceOptions> = {}): AnalyticsServiceOptions {
  return {
    appVersion: '1.2.3',
    appType: 'desktop',
    umami: { endpoint: UMAMI_ENDPOINT, websiteId: UMAMI_WEBSITE_ID },
    getAiModelConfigured: () => true,
    ...overrides,
  }
}

function readAnalyticsData(systemDir: string): {
  anonymousId?: string | null
  firstReportDate?: string | null
  lastReportDate?: string | null
  enabled?: boolean
} {
  return JSON.parse(readFileSync(join(systemDir, 'analytics.json'), 'utf-8'))
}

test('track sends a normalized Umami event without private import details', async () => {
  const systemDir = createTempSystemDir()
  const originalFetch = globalThis.fetch
  const requests: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init })
    return Promise.resolve(new Response(null, { status: 204 }))
  }) as typeof fetch

  try {
    const service = new AnalyticsService(systemDir, createOptions())
    service.setAppLocale('zh-CN')

    assert.equal(
      await service.track('chat_import_completed', {
        chat_platform: 'weixin',
        duration_ms: 1234.4,
        filename: 'private-chat.json',
      }),
      true
    )

    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, UMAMI_ENDPOINT)
    const body = JSON.parse(String(requests[0].init?.body)) as {
      type: string
      payload: {
        website: string
        name: string
        language: string
        id: string
        url: string
        data: Record<string, unknown>
      }
    }
    assert.equal(body.type, 'event')
    assert.equal(body.payload.website, UMAMI_WEBSITE_ID)
    assert.equal(body.payload.name, 'chat_import_completed')
    assert.equal(body.payload.language, 'zh-CN')
    assert.match(body.payload.id, /^[0-9a-f-]{36}$/)
    assert.equal(body.payload.url, '/import')
    assert.deepEqual(body.payload.data, {
      session_id: body.payload.data.session_id,
      app_version: '1.2.3',
      app_type: 'desktop',
      os: process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux',
      app_locale: 'zh-CN',
      ai_model_configured: true,
      schema_version: 1,
      chat_platform: 'weixin',
      duration_ms: 1234,
    })
    assert.equal('filename' in body.payload.data, false)
    assert.match(String(new Headers(requests[0].init?.headers).get('User-Agent')), /^ChatLab\/1\.2\.3/)
  } finally {
    globalThis.fetch = originalFetch
    rmSync(systemDir, { recursive: true, force: true })
  }
})

test('track preserves custom platforms but rejects values that can contain private paths', async () => {
  const systemDir = createTempSystemDir()
  const originalFetch = globalThis.fetch
  const requests: RequestInit[] = []
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(init ?? {})
    return Promise.resolve(new Response(null, { status: 204 }))
  }) as typeof fetch

  try {
    const service = new AnalyticsService(systemDir, createOptions())
    await service.track('chat_import_started', { chat_platform: '自定义导入器 v2' })
    await service.track('chat_import_started', { chat_platform: '/Users/alice/private-export' })

    const platforms = requests.map((request) => JSON.parse(String(request.body)).payload.data.chat_platform)
    assert.deepEqual(platforms, ['自定义导入器 v2', 'unknown'])
  } finally {
    globalThis.fetch = originalFetch
    rmSync(systemDir, { recursive: true, force: true })
  }
})

test('track normalizes the shared locale instead of accepting arbitrary event data', async () => {
  const systemDir = createTempSystemDir()
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init })
    return Promise.resolve(new Response(null, { status: 204 }))
  }) as typeof fetch

  try {
    const service = new AnalyticsService(systemDir, createOptions())
    await service.track('feature_used', { feature_id: 'insights', app_locale: 'ja-JP' })
    await service.track('feature_used', {
      feature_id: 'insights',
      app_locale: '/Users/alice/private-chat.json',
    })

    const first = JSON.parse(String(requests[0].init?.body)) as { payload: { language: string } }
    const second = JSON.parse(String(requests[1].init?.body)) as {
      payload: { language: string; data: Record<string, unknown> }
    }
    assert.equal(first.payload.language, 'ja-JP')
    assert.equal(second.payload.language, 'unknown')
    assert.equal(second.payload.data.app_locale, 'unknown')
    assert.equal(JSON.stringify(second).includes('/Users/alice'), false)
  } finally {
    globalThis.fetch = originalFetch
    rmSync(systemDir, { recursive: true, force: true })
  }
})

test('anonymous id persists across AnalyticsService instances', async () => {
  const systemDir = createTempSystemDir()
  const originalFetch = globalThis.fetch
  const distinctIds: string[] = []
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    distinctIds.push(JSON.parse(String(init?.body)).payload.id)
    return Promise.resolve(new Response(null, { status: 204 }))
  }) as typeof fetch

  try {
    const options = createOptions()
    await new AnalyticsService(systemDir, options).track('app_started')
    await new AnalyticsService(systemDir, options).track('app_started')

    assert.equal(distinctIds[0], distinctIds[1])
    assert.match(distinctIds[0], /^[0-9a-f-]{36}$/)
    assert.equal(readAnalyticsData(systemDir).anonymousId, distinctIds[0])
  } finally {
    globalThis.fetch = originalFetch
    rmSync(systemDir, { recursive: true, force: true })
  }
})

test('disabled analytics sends no event', async () => {
  const systemDir = createTempSystemDir()
  const originalFetch = globalThis.fetch
  let requestCount = 0
  globalThis.fetch = (() => {
    requestCount++
    return Promise.resolve(new Response(null, { status: 204 }))
  }) as typeof fetch

  try {
    const service = new AnalyticsService(systemDir, createOptions())
    service.setEnabled(false)

    assert.equal(await service.track('app_started'), false)
    assert.equal(requestCount, 0)
  } finally {
    globalThis.fetch = originalFetch
    rmSync(systemDir, { recursive: true, force: true })
  }
})

test('trackDailyActive remembers the locale while disabled for later opt-in events', async () => {
  const systemDir = createTempSystemDir()
  const originalFetch = globalThis.fetch
  const requests: RequestInit[] = []
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(init ?? {})
    return Promise.resolve(new Response(null, { status: 204 }))
  }) as typeof fetch

  try {
    const service = new AnalyticsService(systemDir, createOptions())
    service.setEnabled(false)

    await service.trackDailyActive({ app_locale: 'ja-JP' })

    assert.equal(requests.length, 0)
    assert.equal(readAnalyticsData(systemDir).anonymousId, null)

    service.setEnabled(true)
    assert.equal(await service.track('feature_used', { feature_id: 'insights' }), true)

    const body = JSON.parse(String(requests[0].body)) as {
      payload: { language: string; data: Record<string, unknown> }
    }
    assert.equal(body.payload.language, 'ja-JP')
    assert.equal(body.payload.data.app_locale, 'ja-JP')
  } finally {
    globalThis.fetch = originalFetch
    rmSync(systemDir, { recursive: true, force: true })
  }
})

test('unknown events and invalid feature ids are not sent', async () => {
  const systemDir = createTempSystemDir()
  const originalFetch = globalThis.fetch
  let requestCount = 0
  globalThis.fetch = (() => {
    requestCount++
    return Promise.resolve(new Response(null, { status: 204 }))
  }) as typeof fetch

  try {
    const service = new AnalyticsService(systemDir, createOptions())
    assert.equal(await service.track('arbitrary_event'), false)
    assert.equal(await service.track('feature_used', { feature_id: 'some-user-controlled-value' }), false)
    assert.equal(requestCount, 0)
  } finally {
    globalThis.fetch = originalFetch
    rmSync(systemDir, { recursive: true, force: true })
  }
})

test('incremental import usage is tracked without platform properties', async () => {
  const systemDir = createTempSystemDir()
  const originalFetch = globalThis.fetch
  const requests: RequestInit[] = []
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(init ?? {})
    return Promise.resolve(new Response(null, { status: 204 }))
  }) as typeof fetch

  try {
    const service = new AnalyticsService(systemDir, createOptions())
    assert.equal(
      await service.track('incremental_import_used', {
        chat_platform: 'private-platform-value',
      }),
      true
    )

    const body = JSON.parse(String(requests[0].body)) as {
      payload: { name: string; url: string; data: Record<string, unknown> }
    }
    assert.equal(body.payload.name, 'incremental_import_used')
    assert.equal(body.payload.url, '/import/incremental')
    assert.equal('chat_platform' in body.payload.data, false)
  } finally {
    globalThis.fetch = originalFetch
    rmSync(systemDir, { recursive: true, force: true })
  }
})

test('trackDailyActive does not mark the day as reported when Umami rejects', async () => {
  const systemDir = createTempSystemDir()
  const originalFetch = globalThis.fetch
  globalThis.fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch

  try {
    await new AnalyticsService(systemDir, createOptions()).trackDailyActive({ app_locale: 'en-US' })

    const data = readAnalyticsData(systemDir)
    assert.equal(data.lastReportDate, null)
    assert.equal(data.firstReportDate, null)
    assert.ok(data.anonymousId)
  } finally {
    globalThis.fetch = originalFetch
    rmSync(systemDir, { recursive: true, force: true })
  }
})

test('trackDailyActive reports startup every process and daily activity once per day', async () => {
  const systemDir = createTempSystemDir()
  const originalFetch = globalThis.fetch
  const eventNames: string[] = []
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    eventNames.push(JSON.parse(String(init?.body)).payload.name)
    return Promise.resolve(new Response(null, { status: 204 }))
  }) as typeof fetch

  try {
    const options = createOptions()
    const firstProcess = new AnalyticsService(systemDir, options)
    await firstProcess.trackDailyActive({ app_locale: 'zh-CN' })
    await firstProcess.trackDailyActive({ app_locale: 'zh-CN' })
    await new AnalyticsService(systemDir, options).trackDailyActive({ app_locale: 'zh-CN' })

    const today = new Date().toISOString().slice(0, 10)
    assert.deepEqual(eventNames, ['app_started', 'app_active_new', 'app_started'])
    assert.deepEqual(readAnalyticsData(systemDir), {
      enabled: true,
      anonymousId: readAnalyticsData(systemDir).anonymousId,
      firstReportDate: today,
      lastReportDate: today,
    })
  } finally {
    globalThis.fetch = originalFetch
    rmSync(systemDir, { recursive: true, force: true })
  }
})

test('trackDailyActive deduplicates overlapping reports', async () => {
  const systemDir = createTempSystemDir()
  const originalFetch = globalThis.fetch
  const eventNames: string[] = []
  let resolveStartup: (() => void) | undefined
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    eventNames.push(JSON.parse(String(init?.body)).payload.name)
    if (eventNames.length === 1) {
      return new Promise<Response>((resolve) => {
        resolveStartup = () => resolve(new Response(null, { status: 204 }))
      })
    }
    return Promise.resolve(new Response(null, { status: 204 }))
  }) as typeof fetch

  try {
    const service = new AnalyticsService(systemDir, createOptions())
    const first = service.trackDailyActive({ app_locale: 'zh-CN' })
    const second = service.trackDailyActive({ app_locale: 'en-US' })
    resolveStartup?.()
    await Promise.all([first, second])

    assert.deepEqual(eventNames, ['app_started', 'app_active_new'])
  } finally {
    globalThis.fetch = originalFetch
    rmSync(systemDir, { recursive: true, force: true })
  }
})

test('track is a no-op without the official build configuration', async () => {
  const systemDir = createTempSystemDir()
  const previousEndpoint = process.env.UMAMI_ENDPOINT
  const previousWebsiteId = process.env.UMAMI_WEBSITE_ID
  delete process.env.UMAMI_ENDPOINT
  delete process.env.UMAMI_WEBSITE_ID

  try {
    const service = new AnalyticsService(systemDir, { appVersion: '1.2.3', appType: 'desktop' })
    assert.equal(await service.track('app_started'), false)
    assert.equal(existsSync(join(systemDir, 'analytics.json')), false)
  } finally {
    if (previousEndpoint === undefined) delete process.env.UMAMI_ENDPOINT
    else process.env.UMAMI_ENDPOINT = previousEndpoint
    if (previousWebsiteId === undefined) delete process.env.UMAMI_WEBSITE_ID
    else process.env.UMAMI_WEBSITE_ID = previousWebsiteId
    rmSync(systemDir, { recursive: true, force: true })
  }
})
