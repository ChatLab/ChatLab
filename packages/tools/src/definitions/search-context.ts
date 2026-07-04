import type { RawMessage } from '../types'

export function trimMessagesPreservingHits(messages: RawMessage[], hitIds: number[], limit: number): RawMessage[] {
  if (limit <= 0) return []
  if (messages.length <= limit) return messages

  const requiredIds = new Set(hitIds)
  if (requiredIds.size === 0) return messages.slice(0, limit)

  const trimmed = messages.slice(0, limit)
  const presentIds = new Set(trimmed.map((message) => message.id).filter((id): id is number => id != null))
  const missingHits = messages.filter(
    (message) => message.id != null && requiredIds.has(message.id) && !presentIds.has(message.id)
  )

  for (const hit of missingHits) {
    let replaceIndex = -1
    for (let i = trimmed.length - 1; i >= 0; i--) {
      const id = trimmed[i].id
      if (id == null || !requiredIds.has(id)) {
        replaceIndex = i
        break
      }
    }
    if (replaceIndex === -1) break
    trimmed[replaceIndex] = hit
  }

  return trimmed.sort((a, b) => messages.indexOf(a) - messages.indexOf(b))
}
