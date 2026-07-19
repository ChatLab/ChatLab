import assert from 'node:assert/strict'
import test from 'node:test'
import { resolvePlatformCapabilities } from './platform-capabilities'

test('keeps CLI Web authentication and backend startup capabilities', () => {
  assert.deepEqual(resolvePlatformCapabilities({ isElectron: false, isWebWasm: false }), {
    platform: 'cli-web',
    requiresAuth: true,
    usesCliWebHttp: true,
    usesBrowserRuntime: false,
    loadsPreferences: true,
    initializesLlm: true,
    listensForPullResults: true,
  })
})

test('treats Web WASM as a browser runtime without CLI Web backend services', () => {
  assert.deepEqual(resolvePlatformCapabilities({ isElectron: false, isWebWasm: true }), {
    platform: 'web-wasm',
    requiresAuth: false,
    usesCliWebHttp: false,
    usesBrowserRuntime: true,
    loadsPreferences: true,
    initializesLlm: false,
    listensForPullResults: false,
  })
})

test('keeps Electron on its existing backend-backed application path', () => {
  const capabilities = resolvePlatformCapabilities({ isElectron: true, isWebWasm: false })

  assert.equal(capabilities.platform, 'electron')
  assert.equal(capabilities.requiresAuth, false)
  assert.equal(capabilities.usesCliWebHttp, false)
  assert.equal(capabilities.usesBrowserRuntime, false)
  assert.equal(capabilities.loadsPreferences, true)
  assert.equal(capabilities.initializesLlm, true)
  assert.equal(capabilities.listensForPullResults, true)
})
