interface PendingMemoryProvenance {
  aiChatId: string
  expectedParentMessageId: string | null
  memoryIds: Set<string>
  completed: boolean
}

export class MemoryProvenanceCoordinator {
  private readonly pending = new Map<string, PendingMemoryProvenance>()

  begin(token: string, aiChatId: string, expectedParentMessageId: string | null): void {
    this.pending.set(token, {
      aiChatId,
      expectedParentMessageId,
      memoryIds: new Set(),
      completed: false,
    })
  }

  record(token: string, memoryId: string): void {
    const changeSet = this.pending.get(token)
    if (!changeSet || changeSet.completed) return
    changeSet.memoryIds.add(memoryId)
  }

  complete(token: string): void {
    const changeSet = this.pending.get(token)
    if (!changeSet) return
    if (changeSet.memoryIds.size === 0) {
      this.pending.delete(token)
      return
    }
    changeSet.completed = true
  }

  validate(token: string, aiChatId: string, memoryIds: string[]): { expectedParentMessageId: string | null } {
    const changeSet = this.pending.get(token)
    if (!changeSet || !changeSet.completed || changeSet.aiChatId !== aiChatId) {
      throw new Error('Memory provenance token is invalid')
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
}
