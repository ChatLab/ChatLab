import assert from 'node:assert/strict'
import test from 'node:test'
import { syncNativeDialog } from './native-dialog'

test('native lock dialog opens and closes without repeating browser calls', () => {
  let open = false
  let showModalCalls = 0
  let closeCalls = 0
  const dialog = {
    get open() {
      return open
    },
    showModal() {
      showModalCalls += 1
      open = true
    },
    close() {
      closeCalls += 1
      open = false
    },
  }

  syncNativeDialog(dialog, true)
  syncNativeDialog(dialog, true)
  assert.equal(open, true)
  assert.equal(showModalCalls, 1)

  syncNativeDialog(dialog, false)
  syncNativeDialog(dialog, false)
  assert.equal(open, false)
  assert.equal(closeCalls, 1)
})
