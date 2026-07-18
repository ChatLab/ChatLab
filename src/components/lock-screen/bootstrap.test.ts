import assert from 'node:assert/strict'
import test from 'node:test'
import { useLockScreenBootstrap } from './bootstrap'

test('desktop interactions stay blocked until the lock screen is ready and unlocked', () => {
  let dialogOpen = false
  let showModalCalls = 0
  let closeCalls = 0
  const dialog = {
    get open() {
      return dialogOpen
    },
    showModal() {
      showModalCalls += 1
      dialogOpen = true
    },
    close() {
      closeCalls += 1
      dialogOpen = false
    },
  }
  const { isBootstrapMaskVisible, isApplicationInteractive, markLockScreenReady, syncBootstrapMask, updateLockState } =
    useLockScreenBootstrap(true)

  assert.equal(isBootstrapMaskVisible.value, true)
  assert.equal(isApplicationInteractive.value, false)
  syncBootstrapMask(dialog)
  assert.equal(dialogOpen, true)
  assert.equal(showModalCalls, 1)

  updateLockState(false)
  assert.equal(isApplicationInteractive.value, false)
  syncBootstrapMask(dialog)
  assert.equal(showModalCalls, 1)

  markLockScreenReady()
  assert.equal(isBootstrapMaskVisible.value, false)
  assert.equal(isApplicationInteractive.value, true)
  syncBootstrapMask(dialog)
  assert.equal(dialogOpen, false)
  assert.equal(closeCalls, 1)

  updateLockState(true)
  assert.equal(isApplicationInteractive.value, false)

  updateLockState(false)
  assert.equal(isApplicationInteractive.value, true)
})

test('web interactions remain enabled and never use the desktop lock bootstrap mask', () => {
  let showModalCalls = 0
  let closeCalls = 0
  const dialog = {
    open: false,
    showModal() {
      showModalCalls += 1
    },
    close() {
      closeCalls += 1
    },
  }
  const { isBootstrapMaskVisible, isApplicationInteractive, syncBootstrapMask, updateLockState } =
    useLockScreenBootstrap(false)

  assert.equal(isBootstrapMaskVisible.value, false)
  assert.equal(isApplicationInteractive.value, true)
  syncBootstrapMask(dialog)
  assert.equal(showModalCalls, 0)
  assert.equal(closeCalls, 0)

  updateLockState(true)
  assert.equal(isApplicationInteractive.value, true)
})
