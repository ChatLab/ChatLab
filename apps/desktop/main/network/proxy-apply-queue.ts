export class ProxyApplyQueue {
  private pendingApply: Promise<unknown> | null = null

  apply<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.pendingApply ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(task)
    this.pendingApply = current

    const clear = () => {
      if (this.pendingApply === current) this.pendingApply = null
    }
    current.then(clear, clear)

    return current
  }

  async waitForPending(): Promise<void> {
    const pending = this.pendingApply
    if (pending) await pending
  }
}
