import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detectPlatform, getRegisteredAdapter, initializeWebWasmServices } from './registry'

describe('detectPlatform', () => {
  it('uses canonical platform identifiers for every runtime', () => {
    assert.equal(detectPlatform({ isElectron: true, isWebWasm: false }), 'electron')
    assert.equal(detectPlatform({ isElectron: false, isWebWasm: false }), 'cli-web')
    assert.equal(detectPlatform({ isElectron: false, isWebWasm: true }), 'web-wasm')
  })
})

describe('initializeWebWasmServices', () => {
  it('initializes Web WASM adapters only through the entry-provided initializer', async () => {
    const adapter = { runtime: 'web-wasm' }

    await initializeWebWasmServices(({ register }) => register('test-web-wasm', adapter))

    assert.equal(getRegisteredAdapter('test-web-wasm'), adapter)
  })
})
