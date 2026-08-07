import assert from 'node:assert/strict'
import test from 'node:test'
import type { BrowserCapabilityReport } from '@openchatlab/web-runtime'
import {
  initializeAppRuntime,
  initializeProgressiveAppRuntime,
  UnsupportedBrowserCapabilitiesError,
} from './app-initialization'

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
      initializeLocale: async () => void calls.push('locale'),
      loadSessions: async () => void calls.push('sessions'),
    }),
    (error: unknown) =>
      error instanceof UnsupportedBrowserCapabilitiesError && assert.deepEqual(error.missing, ['opfs']) === undefined
  )

  assert.deepEqual(calls, ['services', 'capabilities'])
})

test('reveals the shell after presentation state and runs independent startup work concurrently', async () => {
  const calls: string[] = []
  const releaseTasks: Array<() => void> = []
  const stop = () => undefined

  const result = await initializeProgressiveAppRuntime({
    initializeServices: async () => void calls.push('services'),
    loadPresentation: async () => {
      calls.push('load-presentation')
      return { locale: 'zh-CN' }
    },
    applyPresentation: (presentation) => void calls.push(`apply-${presentation.locale}`),
    applyPresentationFallback: () => void calls.push('fallback'),
    initializeBackground: ['preferences', 'llm', 'sessions'].map((name) => ({
      name,
      run: async () => {
        calls.push(`start-${name}`)
        await new Promise<void>((resolve) => releaseTasks.push(resolve))
        calls.push(`finish-${name}`)
      },
    })),
    listenForPullResults: () => {
      calls.push('pull-listener')
      return stop
    },
  })

  assert.deepEqual(calls, [
    'services',
    'load-presentation',
    'apply-zh-CN',
    'pull-listener',
    'start-preferences',
    'start-llm',
    'start-sessions',
  ])
  assert.equal(result.presentationError, null)
  assert.equal(result.stopListeningForPullResults, stop)

  releaseTasks.forEach((release) => release())
  assert.deepEqual(await result.background, [])
})

test('uses the presentation fallback on timeout and reports background failures by task', async () => {
  const failure = new Error('session catalog unavailable')
  let applyLatePresentation = false

  const result = await initializeProgressiveAppRuntime({
    initializeServices: async () => undefined,
    loadPresentation: async () => new Promise<{ locale: string }>(() => undefined),
    applyPresentation: () => {
      applyLatePresentation = true
    },
    applyPresentationFallback: async () => undefined,
    presentationTimeoutMs: 5,
    initializeBackground: [
      { name: 'preferences', run: async () => undefined },
      { name: 'sessions', run: async () => Promise.reject(failure) },
    ],
  })

  assert.match(String(result.presentationError), /timed out after 5ms/)
  assert.equal(applyLatePresentation, false)
  assert.deepEqual(await result.background, [{ name: 'sessions', error: failure }])
})
