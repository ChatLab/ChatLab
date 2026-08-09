type InteractiveStateListener = (active: boolean) => void
type SessionDeleteListener = (sessionId: string) => void | Promise<void>

class ChatTopicWorkCoordinator {
  private interactiveCount = 0
  private readonly listeners = new Set<InteractiveStateListener>()
  private readonly sessionDeleteListeners = new Set<SessionDeleteListener>()

  get isInteractiveActive(): boolean {
    return this.interactiveCount > 0
  }

  beginInteractiveWork(): () => void {
    this.interactiveCount += 1
    if (this.interactiveCount === 1) this.notify(true)
    let released = false
    return () => {
      if (released) return
      released = true
      this.interactiveCount = Math.max(0, this.interactiveCount - 1)
      if (this.interactiveCount === 0) this.notify(false)
    }
  }

  subscribe(listener: InteractiveStateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribeSessionDelete(listener: SessionDeleteListener): () => void {
    this.sessionDeleteListeners.add(listener)
    return () => this.sessionDeleteListeners.delete(listener)
  }

  async prepareSessionDelete(sessionId: string): Promise<void> {
    await Promise.all([...this.sessionDeleteListeners].map((listener) => listener(sessionId)))
  }

  private notify(active: boolean): void {
    for (const listener of this.listeners) listener(active)
  }
}

export const chatTopicWorkCoordinator = new ChatTopicWorkCoordinator()
