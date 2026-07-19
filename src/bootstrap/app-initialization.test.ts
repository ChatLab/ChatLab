import assert from 'node:assert/strict'
import test from 'node:test'
import type { BrowserCapabilityReport } from '@openchatlab/web-runtime'
import { initializeAppRuntime, UnsupportedBrowserCapabilitiesError } from './app-initialization'

const supportedBrowserCapabilities: BrowserCapabilityReport = {
  supported: true,
  capabilities: {
    webAssembly: true,
    dedicatedWorker: true,
    opfs: true,
    storageEstimate: true,
    secureContext: true,
  },
  missing: [],
}

test('keeps the backend-backed application initialization sequence', async () => {
  const calls: string[] = []
  const stop = () => undefined

  const result = await initializeAppRuntime({
    capabilities: {
      platform: 'cli-web',
      requiresAuth: true,
      usesCliWebHttp: true,
      usesBrowserRuntime: false,
      loadsPreferences: true,
      initializesLlm: true,
      listensForPullResults: true,
    },
    initializeServices: async () => void calls.push('services'),
    initializePreferences: async () => void calls.push('preferences'),
    initializeLocale: async () => void calls.push('locale'),
    initializeLlm: async () => void calls.push('llm'),
    loadSessions: async () => void calls.push('sessions'),
    listenForPullResults: () => {
      calls.push('pull-listener')
      return stop
    },
  })

  assert.deepEqual(calls, ['services', 'preferences', 'locale', 'llm', 'sessions', 'pull-listener'])
  assert.equal(result.stopListeningForPullResults, stop)
  assert.equal(result.browserCapabilities, null)
})

test('checks browser capabilities and applies locale before loading Web WASM sessions', async () => {
  const calls: string[] = []

  const result = await initializeAppRuntime({
    capabilities: {
      platform: 'web-wasm',
      requiresAuth: false,
      usesCliWebHttp: false,
      usesBrowserRuntime: true,
      loadsPreferences: true,
      initializesLlm: false,
      listensForPullResults: false,
    },
    initializeServices: async () => void calls.push('services'),
    checkBrowserCapabilities: async () => {
      calls.push('capabilities')
      return supportedBrowserCapabilities
    },
    initializePreferences: async () => void calls.push('preferences'),
    initializeLocale: async () => void calls.push('locale'),
    loadSessions: async () => void calls.push('sessions'),
  })

  assert.deepEqual(calls, ['services', 'capabilities', 'preferences', 'locale', 'sessions'])
  assert.equal(result.browserCapabilities, supportedBrowserCapabilities)
  assert.equal(result.stopListeningForPullResults, null)
})

test('does not open Web WASM session storage when required browser capabilities are missing', async () => {
  const calls: string[] = []
  const unsupported: BrowserCapabilityReport = {
    ...supportedBrowserCapabilities,
    supported: false,
    capabilities: { ...supportedBrowserCapabilities.capabilities, opfs: false },
    missing: ['opfs'],
  }

  await assert.rejects(
    initializeAppRuntime({
      capabilities: {
        platform: 'web-wasm',
        requiresAuth: false,
        usesCliWebHttp: false,
        usesBrowserRuntime: true,
        loadsPreferences: true,
        initializesLlm: false,
        listensForPullResults: false,
      },
      initializeServices: async () => void calls.push('services'),
      checkBrowserCapabilities: async () => {
        calls.push('capabilities')
        return unsupported
      },
      initializePreferences: async () => void calls.push('preferences'),
      loadSessions: async () => void calls.push('sessions'),
    }),
    (error: unknown) =>
      error instanceof UnsupportedBrowserCapabilitiesError && assert.deepEqual(error.missing, ['opfs']) === undefined
  )

  assert.deepEqual(calls, ['services', 'capabilities'])
})
