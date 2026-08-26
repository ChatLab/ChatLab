interface PendingMemoryProvenance {
  aiChatId: string
  expectedParentMessageId: string | null
  memoryIds: Set<string>
  completed: boolean
  expiresAt: number
}

const DEFAULT_TTL_MS = 10 * 60 * 1000

export class MemoryProvenanceCoordinator {
  private readonly pending = new Map<string, PendingMemoryProvenance>()

  constructor(private readonly ttlMs = DEFAULT_TTL_MS) {}

  begin(token: string, aiChatId: string, expectedParentMessageId: string | null): void {
    this.cleanupExpired()
    this.pending.set(token, {
      aiChatId,
      expectedParentMessageId,
      memoryIds: new Set(),
      completed: false,
      expiresAt: Date.now() + this.ttlMs,
    })
  }

  record(token: string, memoryId: string): void {
    const changeSet = this.pending.get(token)
    if (!changeSet || changeSet.completed || Date.now() > changeSet.expiresAt) return
    changeSet.memoryIds.add(memoryId)
  }

  complete(token: string): void {
    const changeSet = this.pending.get(token)
    if (!changeSet) return
    changeSet.completed = true
  }

  validate(token: string, aiChatId: string, memoryIds: string[]): { expectedParentMessageId: string | null } {
    this.cleanupExpired()
    const changeSet = this.pending.get(token)
    if (!changeSet || !changeSet.completed || changeSet.aiChatId !== aiChatId) {
      throw new Error('Memory provenance token is invalid or expired')
    }

    const requestedIds = new Set(memoryIds)
    if (
      requestedIds.size !== changeSet.memoryIds.size ||
      [...requestedIds].some((memoryId) => !changeSet.memoryIds.has(memoryId))
    ) {
      throw new Error('Memory IDs do not match the agent turn change set')
    }
    return { expectedParentMessageId: changeSet.expectedParentMessageId }
  }

  consume(token: string): void {
    this.pending.delete(token)
  }

  private cleanupExpired(): void {
    const now = Date.now()
    for (const [token, changeSet] of this.pending) {
      if (now > changeSet.expiresAt) this.pending.delete(token)
    }
  }
}
