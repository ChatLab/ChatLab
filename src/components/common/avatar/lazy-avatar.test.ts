/**
 * Run: pnpm test -- src/components/common/avatar/lazy-avatar.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { createLazyAvatarObserver } from './lazy-avatar'

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []

  readonly callback: IntersectionObserverCallback
  readonly options?: IntersectionObserverInit
  observed: Element[] = []
  disconnectCount = 0

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback
    this.options = options
    FakeIntersectionObserver.instances.push(this)
  }

  observe(element: Element) {
    this.observed.push(element)
  }

  disconnect() {
    this.disconnectCount += 1
  }

  trigger(isIntersecting: boolean) {
    const entry = { isIntersecting } as IntersectionObserverEntry
    this.callback([entry], this as unknown as IntersectionObserver)
  }
}

function installFakeObserver() {
  FakeIntersectionObserver.instances = []
  const previous = globalThis.IntersectionObserver
  globalThis.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver
  return () => {
    globalThis.IntersectionObserver = previous
  }
}

test('waits until the avatar intersects before loading the image', () => {
  const restore = installFakeObserver()
  try {
    let loaded = 0
    const element = {} as Element

    const cleanup = createLazyAvatarObserver(element, () => {
      loaded += 1
    })

    assert.equal(loaded, 0)
    assert.equal(FakeIntersectionObserver.instances.length, 1)
    assert.deepEqual(FakeIntersectionObserver.instances[0].observed, [element])

    FakeIntersectionObserver.instances[0].trigger(false)

    assert.equal(loaded, 0)
    assert.equal(FakeIntersectionObserver.instances[0].disconnectCount, 0)

    cleanup()
  } finally {
    restore()
  }
})

test('loads the avatar once and disconnects after it intersects', () => {
  const restore = installFakeObserver()
  try {
    let loaded = 0

    createLazyAvatarObserver({} as Element, () => {
      loaded += 1
    })

    const observer = FakeIntersectionObserver.instances[0]
    observer.trigger(true)
    observer.trigger(true)

    assert.equal(loaded, 1)
    assert.equal(observer.disconnectCount, 1)
  } finally {
    restore()
  }
})

test('loads immediately when IntersectionObserver is unavailable', () => {
  const previous = globalThis.IntersectionObserver
  try {
    globalThis.IntersectionObserver = undefined as unknown as typeof IntersectionObserver

    let loaded = 0
    const cleanup = createLazyAvatarObserver({} as Element, () => {
      loaded += 1
    })

    assert.equal(loaded, 1)
    cleanup()
  } finally {
    globalThis.IntersectionObserver = previous
  }
})
