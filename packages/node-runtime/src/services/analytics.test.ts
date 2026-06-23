import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AnalyticsService } from './analytics'

const APP_KEY = 'app-US-test'

function createTempSystemDir(): string {
  return mkdtempSync(join(tmpdir(), 'chatlab-analytics-'))
}

function readAnalyticsData(systemDir: string): {
  firstReportDate?: string | null
  lastReportDate?: string | null
} {
  return JSON.parse(readFileSync(join(systemDir, 'analytics.json'), 'utf-8'))
}

test('trackDailyActive does not mark the day as reported when fetch rejects', async () => {
  const systemDir = createTempSystemDir()
  const originalFetch = globalThis.fetch
  const originalConsoleError = console.error
  globalThis.fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch
  console.error = () => {}

  try {
    await new AnalyticsService(systemDir, APP_KEY, '1.0.0').trackDailyActive()

    assert.equal(existsSync(join(systemDir, 'analytics.json')), false)
  } finally {
    console.error = originalConsoleError
    globalThis.fetch = originalFetch
    rmSync(systemDir, { recursive: true, force: true })
  }
})

test('trackDailyActive does not mark the day as reported when Aptabase returns non-OK', async () => {
  const systemDir = createTempSystemDir()
  const originalFetch = globalThis.fetch
  globalThis.fetch = (() => Promise.resolve(new Response(null, { status: 500 }))) as typeof fetch

  try {
    await new AnalyticsService(systemDir, APP_KEY, '1.0.0').trackDailyActive()

    assert.equal(existsSync(join(systemDir, 'analytics.json')), false)
  } finally {
    globalThis.fetch = originalFetch
    rmSync(systemDir, { recursive: true, force: true })
  }
})

test('trackDailyActive marks the day as reported after a successful post', async () => {
  const systemDir = createTempSystemDir()
  const originalFetch = globalThis.fetch
  const requests: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init })
    return Promise.resolve(new Response(null, { status: 204 }))
  }) as typeof fetch

  try {
    await new AnalyticsService(systemDir, APP_KEY, '1.0.0').trackDailyActive({ platform: 'cli-web' })

    const today = new Date().toISOString().slice(0, 10)
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, 'https://us.aptabase.com/api/v0/event')
    assert.equal(JSON.parse(String(requests[0].init?.body)).eventName, 'app_active_new')
    assert.deepEqual(readAnalyticsData(systemDir), {
      enabled: true,
      firstReportDate: today,
      lastReportDate: today,
    })
  } finally {
    globalThis.fetch = originalFetch
    rmSync(systemDir, { recursive: true, force: true })
  }
})
