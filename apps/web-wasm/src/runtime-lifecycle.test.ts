import assert from 'node:assert/strict'
import test from 'node:test'
import { handleWebWasmPageHide } from './runtime-lifecycle'

test('keeps the Web WASM runtime alive when the page may enter the back-forward cache', () => {
  let disposeCount = 0

  handleWebWasmPageHide({ persisted: true }, () => disposeCount++)

  assert.equal(disposeCount, 0)
})

test('disposes the Web WASM runtime when the page is being discarded', () => {
  let disposeCount = 0

  handleWebWasmPageHide({ persisted: false }, () => disposeCount++)

  assert.equal(disposeCount, 1)
})
