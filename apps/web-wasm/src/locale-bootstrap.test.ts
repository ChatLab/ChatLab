import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveWebWasmInitialLocale } from './locale-bootstrap'

test('uses the saved Web WASM locale before browser language detection', () => {
  assert.equal(resolveWebWasmInitialLocale('ja-JP', ['zh-CN']), 'ja-JP')
})

test('detects the browser language for a first visit or invalid saved locale', () => {
  assert.equal(resolveWebWasmInitialLocale('', ['zh-Hant-TW']), 'zh-TW')
  assert.equal(resolveWebWasmInitialLocale('unsupported', ['en-GB']), 'en-US')
})
