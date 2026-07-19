import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveHomeFooterConfigSource } from './home-footer-config'

test('keeps Web WASM footer configuration cache-only', () => {
  assert.equal(resolveHomeFooterConfigSource({ remoteConfigEnabled: false, isElectron: false }), 'cache-only')
})

test('uses the platform adapter for Electron footer configuration', () => {
  assert.equal(resolveHomeFooterConfigSource({ remoteConfigEnabled: true, isElectron: true }), 'platform')
})

test('uses direct network fetch for CLI Web footer configuration', () => {
  assert.equal(resolveHomeFooterConfigSource({ remoteConfigEnabled: true, isElectron: false }), 'network')
})
