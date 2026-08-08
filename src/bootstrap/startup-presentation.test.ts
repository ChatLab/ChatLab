import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveStartupPresentation } from './startup-presentation'

test('mounts the shell behind the cover until both runtime and animation are ready', () => {
  assert.deepEqual(
    resolveStartupPresentation({
      runtimeReady: false,
      animationComplete: false,
      waitForAnimation: true,
      initializationFailed: false,
    }),
    {
      mountShell: false,
      showCover: true,
      showError: false,
      showWaitingIndicator: false,
    }
  )

  assert.deepEqual(
    resolveStartupPresentation({
      runtimeReady: true,
      animationComplete: false,
      waitForAnimation: true,
      initializationFailed: false,
    }),
    {
      mountShell: true,
      showCover: true,
      showError: false,
      showWaitingIndicator: false,
    }
  )

  assert.deepEqual(
    resolveStartupPresentation({
      runtimeReady: true,
      animationComplete: true,
      waitForAnimation: true,
      initializationFailed: false,
    }),
    {
      mountShell: true,
      showCover: false,
      showError: false,
      showWaitingIndicator: false,
    }
  )
})

test('allows the refresh cover to leave before the shared animation completes', () => {
  assert.deepEqual(
    resolveStartupPresentation({
      runtimeReady: false,
      animationComplete: false,
      waitForAnimation: false,
      initializationFailed: false,
    }),
    {
      mountShell: false,
      showCover: true,
      showError: false,
      showWaitingIndicator: false,
    }
  )

  assert.deepEqual(
    resolveStartupPresentation({
      runtimeReady: true,
      animationComplete: false,
      waitForAnimation: false,
      initializationFailed: false,
    }),
    {
      mountShell: true,
      showCover: false,
      showError: false,
      showWaitingIndicator: false,
    }
  )
})

test('holds the completed brand frame for slow initialization and exposes failures immediately', () => {
  assert.deepEqual(
    resolveStartupPresentation({
      runtimeReady: false,
      animationComplete: true,
      waitForAnimation: true,
      initializationFailed: false,
    }),
    {
      mountShell: false,
      showCover: true,
      showError: false,
      showWaitingIndicator: true,
    }
  )

  assert.deepEqual(
    resolveStartupPresentation({
      runtimeReady: false,
      animationComplete: false,
      waitForAnimation: true,
      initializationFailed: true,
    }),
    {
      mountShell: false,
      showCover: true,
      showError: true,
      showWaitingIndicator: false,
    }
  )
})
