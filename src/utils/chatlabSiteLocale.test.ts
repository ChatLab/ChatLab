import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveChatlabSiteBase } from './chatlabSiteLocale'

test('uses the direct site URL for Web WASM instead of the CLI Web development proxy', () => {
  assert.equal(resolveChatlabSiteBase({ isElectron: false, isWebWasm: true }), 'https://chatlab.fun')
})

test('keeps the development proxy for CLI Web', () => {
  assert.equal(resolveChatlabSiteBase({ isElectron: false, isWebWasm: false }), '/_proxy/chatlab.fun')
})
