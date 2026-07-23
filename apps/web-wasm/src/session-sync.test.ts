import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { WebWasmSessionSync, type WebWasmSessionSyncChannel } from './session-sync'

class FakeChannelBus {
  readonly channels = new Set<FakeChannel>()

  create(): FakeChannel {
    const channel = new FakeChannel(this)
    this.channels.add(channel)
    return channel
  }
}

class FakeChannel implements WebWasmSessionSyncChannel {
  private readonly listeners = new Set<(event: MessageEvent<unknown>) => void>()

  constructor(private readonly bus: FakeChannelBus) {}

  postMessage(message: unknown): void {
    for (const channel of this.bus.channels) {
      if (channel === this) continue
      channel.emit(message)
    }
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.delete(listener)
  }

  close(): void {
    this.bus.channels.delete(this)
    this.listeners.clear()
  }

  private emit(message: unknown): void {
    for (const listener of this.listeners) listener({ data: message } as MessageEvent<unknown>)
  }
}

describe('WebWasmSessionSync', () => {
  it('notifies other tabs about successful session mutations without echoing to the sender', () => {
    const bus = new FakeChannelBus()
    const first = new WebWasmSessionSync(bus.create())
    const second = new WebWasmSessionSync(bus.create())
    const firstEvents: string[] = []
    const secondEvents: string[] = []
    first.subscribe((event) => firstEvents.push(`${event.type}:${event.sessionId}`))
    second.subscribe((event) => secondEvents.push(`${event.type}:${event.sessionId}`))

    first.publish({ type: 'rename', sessionId: 'session-one' })

    assert.deepEqual(firstEvents, [])
    assert.deepEqual(secondEvents, ['rename:session-one'])
    first.dispose()
    second.dispose()
  })

  it('ignores malformed channel messages', () => {
    const bus = new FakeChannelBus()
    const sender = bus.create()
    const receiver = new WebWasmSessionSync(bus.create())
    let received = false
    receiver.subscribe(() => {
      received = true
    })

    sender.postMessage({ type: 'unknown', sessionId: 'session-one' })

    assert.equal(received, false)
    receiver.dispose()
  })
})
